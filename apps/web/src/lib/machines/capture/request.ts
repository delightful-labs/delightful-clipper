import { assign, fromCallback, fromPromise, setup } from 'xstate'
import type { ActorLogic, Snapshot } from 'xstate'
import type { GatewayInput, GatewayResult } from './gateway.js'
import { CaptureError } from '../../server/capture/errors.js'
export type CaptureInput = { operationId: string; url: string }
export type RequestInput = {
	request: Request
	accountId: string | undefined
	mode: 'resolve' | 'extract'
	enabled: boolean
}
type RequestCapability<G extends Snapshot<GatewayResult>> = {
	acquire: (owner: string) => () => void
	read: (request: Request, signal: AbortSignal) => Promise<CaptureInput>
	gateway: ActorLogic<G, { type: 'CANCEL' }, GatewayInput>
	now: () => number
	deadlineMs?: number
}
const headers = {
	'Cache-Control': 'private, no-store',
	'Content-Type': 'application/json',
	'X-Content-Type-Options': 'nosniff'
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing request resource')
	return value
}
export function createCaptureRequestMachine<G extends Snapshot<GatewayResult>>(
	cap: RequestCapability<G>
) {
	type Context = {
		input: RequestInput | undefined
		controller: AbortController
		signal: AbortSignal
		expiresAt: number
		interruption: 'cancel' | 'deadline' | undefined
		release: (() => void) | undefined
		parsed: CaptureInput | undefined
		response: Response | undefined
	}
	const timeout = cap.deadlineMs ?? 20000
	const interrupted = (c: Context) =>
		c.interruption !== undefined || c.signal.aborted || cap.now() >= c.expiresAt
	const failure = (c: Context, error: unknown) => {
		const issue =
			error instanceof CaptureError
				? error
				: interrupted(c)
					? new CaptureError(
							c.interruption === 'deadline' || cap.now() >= c.expiresAt
								? 'fetchTimeout'
								: 'canceled',
							c.interruption === 'deadline' || cap.now() >= c.expiresAt ? 504 : 408,
							true
						)
					: new CaptureError('sourceUnavailable', 502, true)
		return new Response(JSON.stringify({ code: issue.code, retryable: issue.retryable }), {
			status: issue.status,
			headers: { ...headers, ...(issue.status === 429 ? { 'Retry-After': '60' } : {}) }
		})
	}
	const actors = {
		cancellation: fromCallback<{ type: 'UNUSED' }, AbortSignal>(({ input, sendBack }) => {
			const abort = () => sendBack({ type: 'CANCEL' })
			input.addEventListener('abort', abort, { once: true })
			if (input.aborted) abort()
			return () => input.removeEventListener('abort', abort)
		}),
		authorize: fromPromise(async ({ input }: { input: RequestInput }) => {
			if (!input.accountId) throw new CaptureError('sessionUnavailable', 401)
			if (!input.enabled) throw new CaptureError('gatewayUnavailable', 503, true)
			const origin = input.request.headers.get('origin')
			if (origin && origin !== new URL(input.request.url).origin)
				throw new CaptureError('permissionDenied', 403)
		}),
		acquire: fromPromise(async ({ input }: { input: string }) => cap.acquire(input)),
		read: fromPromise(({ input }: { input: { request: Request; signal: AbortSignal } }) =>
			cap.read(input.request, input.signal)
		),
		gateway: cap.gateway,
		encode: fromPromise(
			async ({
				input
			}: {
				input: { parsed: CaptureInput; result: GatewayResult; mode: RequestInput['mode'] }
			}) => {
				if (input.result.kind === 'failed') throw input.result.error
				const result = input.result
				const payload = JSON.stringify(
					input.mode === 'resolve'
						? {
								operationId: input.parsed.operationId,
								submittedUrl: input.parsed.url,
								finalUrl: result.finalUrl,
								redirects: result.provenance.redirects,
								resolvedAt: result.provenance.resolvedAt
							}
						: {
								operationId: input.parsed.operationId,
								finalUrl: result.finalUrl,
								provenance: result.provenance,
								...result.extraction
							}
				)
				if (new TextEncoder().encode(payload).length > 5 * 1024 * 1024)
					throw new CaptureError('sourceTooLarge', 413)
				return new Response(payload, { headers })
			}
		)
	}
	type FullContext = Context & { result: GatewayResult | undefined }
	return setup<
		FullContext,
		{ type: 'CANCEL' },
		typeof actors,
		{},
		{ cancel: undefined; deadline: undefined },
		{},
		never,
		string,
		RequestInput,
		Response
	>({
		actors,
		actions: {
			cancel: assign(({ context }) => {
				context.controller.abort()
				return { interruption: context.interruption ?? 'cancel' }
			}),
			deadline: assign(({ context }) => {
				context.controller.abort()
				return { interruption: context.interruption ?? 'deadline' }
			})
		}
	}).createMachine({
		id: 'capture-request',
		initial: 'owning',
		context: ({ input }) => {
			const controller = new AbortController()
			return {
				input,
				controller,
				signal: AbortSignal.any([input.request.signal, controller.signal]),
				expiresAt: cap.now() + timeout,
				interruption: undefined,
				release: undefined,
				parsed: undefined,
				response: undefined,
				result: undefined
			}
		},
		output: ({ context }) => required(context.response),
		states: {
			owning: {
				invoke: {
					src: 'cancellation',
					input: ({ context }) => required(context.input).request.signal
				},
				after: { [timeout]: { actions: 'deadline' } },
				on: { CANCEL: { actions: 'cancel' } },
				initial: 'authorizing',
				states: {
					beforeReading: {
						always: [
							{
								guard: ({ context }) => interrupted(context),
								target: 'releasing',
								actions: assign({ response: ({ context }) => failure(context, undefined) })
							},
							{ target: 'reading' }
						]
					},
					beforeCapturing: {
						always: [
							{
								guard: ({ context }) => interrupted(context),
								target: 'releasing',
								actions: assign({ response: ({ context }) => failure(context, undefined) })
							},
							{ target: 'capturing' }
						]
					},
					beforeEncoding: {
						always: [
							{
								guard: ({ context }) => interrupted(context),
								target: 'releasing',
								actions: assign({ response: ({ context }) => failure(context, undefined) })
							},
							{ target: 'encoding' }
						]
					},
					authorizing: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => required(context.input),
							onDone: 'acquiring',
							onError: {
								target: 'releasing',
								actions: assign({ response: ({ context, event }) => failure(context, event.error) })
							}
						}
					},
					acquiring: {
						invoke: {
							src: 'acquire',
							input: ({ context }) => required(required(context.input).accountId),
							onDone: {
								target: 'beforeReading',
								actions: assign({ release: ({ event }) => event.output })
							},
							onError: {
								target: 'releasing',
								actions: assign({ response: ({ context, event }) => failure(context, event.error) })
							}
						}
					},
					reading: {
						invoke: {
							src: 'read',
							input: ({ context }) => ({
								request: required(context.input).request,
								signal: context.signal
							}),
							onDone: {
								target: 'beforeCapturing',
								actions: assign({ parsed: ({ event }) => event.output })
							},
							onError: {
								target: 'releasing',
								actions: assign({ response: ({ context, event }) => failure(context, event.error) })
							}
						}
					},
					capturing: {
						invoke: {
							src: 'gateway',
							input: ({ context }) => ({
								url: required(context.parsed).url,
								mode: required(context.input).mode,
								signal: context.signal
							}),
							onDone: {
								target: 'beforeEncoding',
								actions: assign({ result: ({ event }) => required<GatewayResult>(event.output) })
							},
							onError: {
								target: 'releasing',
								actions: assign({ response: ({ context, event }) => failure(context, event.error) })
							}
						}
					},
					encoding: {
						invoke: {
							src: 'encode',
							input: ({ context }) => ({
								parsed: required(context.parsed),
								result: required(context.result),
								mode: required(context.input).mode
							}),
							onDone: {
								target: 'releasing',
								actions: assign({
									response: ({ context, event }) =>
										interrupted(context) ? failure(context, undefined) : event.output
								})
							},
							onError: {
								target: 'releasing',
								actions: assign({ response: ({ context, event }) => failure(context, event.error) })
							}
						}
					},
					releasing: {
						entry: ({ context }) => context.release?.(),
						always: '#capture-request.closed'
					}
				}
			},
			closed: {
				type: 'final',
				entry: assign({
					input: undefined,
					release: undefined,
					parsed: undefined,
					result: undefined
				})
			}
		}
	})
}
