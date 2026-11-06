import { assign, fromCallback, fromPromise, setup, stateIn, or } from 'xstate'
import type { ActorLogic, Snapshot } from 'xstate'
import type { GatewayInput, GatewayResult } from './gateway.js'
import { CaptureError } from '../../server/capture/errors.js'
export type { CaptureInput } from '../../contracts/capture-input.js'
import type { CaptureInput } from '../../contracts/capture-input.js'
export type RequestInput = {
	request: Request
	accountId: string | undefined
	mode: 'resolve' | 'extract' | 'asset'
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
function gatewaySuccess(value: GatewayResult | undefined) {
	if (value?.kind !== 'success') throw new Error('Expected successful gateway result')
	return value
}
function gatewayFailure(value: GatewayResult | undefined) {
	if (value?.kind !== 'failed') throw new Error('Expected failed gateway result')
	return value.error
}
export function createCaptureRequestMachine<G extends Snapshot<GatewayResult>>(
	cap: RequestCapability<G>
) {
	type Context = {
		input: RequestInput | undefined
		controller: AbortController
		signal: AbortSignal
		expiresAt: number
		release: (() => void) | undefined
		parsed: CaptureInput | undefined
		response: Response | undefined
	}
	const timeout = cap.deadlineMs ?? 20000
	const failure = (error: unknown) => {
		const issue =
			error instanceof CaptureError ? error : new CaptureError('sourceUnavailable', 502, true)
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

		acquire: fromPromise(async ({ input }: { input: string }) => cap.acquire(input)),
		read: fromPromise(({ input }: { input: { request: Request; signal: AbortSignal } }) =>
			cap.read(input.request, input.signal)
		),
		gateway: cap.gateway,
		encode: fromPromise(async ({ input }: { input: unknown }) => {
			const payload = JSON.stringify(input)
			if (new TextEncoder().encode(payload).length > 5 * 1024 * 1024)
				throw new CaptureError('sourceTooLarge', 413)
			return new Response(payload, { headers })
		})
	}
	type FullContext = Context & { result: GatewayResult | undefined }
	const model = setup<
		FullContext,
		{ type: 'CANCEL' },
		typeof actors,
		{},
		{ recordFailure: undefined },
		{ timedOut: undefined; cancelled: undefined; captureError: undefined },
		never,
		string,
		RequestInput,
		Response
	>({
		actors,
		actions: {
			recordFailure: assign({
				response: ({ event }) => failure('error' in event ? event.error : undefined)
			})
		},
		guards: {
			timedOut: or([
				stateIn({ owning: { control: 'timedOut' } }),
				({ context }) => cap.now() >= context.expiresAt
			]),
			cancelled: or([
				stateIn({ owning: { control: 'cancelled' } }),
				({ context }) => context.signal.aborted
			]),
			captureError: ({ event }) => 'error' in event && event.error instanceof CaptureError
		}
	})
	const interruptions = [
		{ guard: 'timedOut' as const, target: '#request-timeout-response' },
		{ guard: 'cancelled' as const, target: '#request-cancelled-response' }
	]
	const errors = [
		{ guard: 'captureError' as const, target: 'releasing', actions: 'recordFailure' as const },
		...interruptions,
		{ target: 'releasing', actions: 'recordFailure' as const }
	]
	const interruptedStage = (next: 'reading' | 'capturing' | 'routingResponse') =>
		model.createStateConfig({ always: [...interruptions, { target: next }] })
	const encoding = (payload: (args: { context: FullContext }) => unknown) =>
		model.createStateConfig({
			invoke: {
				src: 'encode',
				input: payload,
				onDone: [
					...interruptions,
					{ target: 'releasing', actions: assign({ response: ({ event }) => event.output }) }
				],
				onError: errors
			}
		})
	const work = model.createStateConfig({
		initial: 'authorizing',
		states: {
			cancelledResponse: {
				id: 'request-cancelled-response',
				entry: assign({ response: () => failure(new CaptureError('canceled', 408, true)) }),
				always: 'releasing'
			},
			timeoutResponse: {
				id: 'request-timeout-response',
				entry: assign({
					response: () => failure(new CaptureError('fetchTimeout', 504, true))
				}),
				always: 'releasing'
			},
			beforeReading: interruptedStage('reading'),
			beforeCapturing: interruptedStage('capturing'),
			beforeEncoding: interruptedStage('routingResponse'),
			authorizing: {
				always: [
					{
						guard: ({ context }) => !required(context.input).accountId,
						target: 'releasing',
						actions: assign({
							response: () => failure(new CaptureError('sessionUnavailable', 401))
						})
					},
					{
						guard: ({ context }) => !required(context.input).enabled,
						target: 'releasing',
						actions: assign({
							response: () => failure(new CaptureError('gatewayUnavailable', 503, true))
						})
					},
					{
						guard: ({ context }) => {
							const request = required(context.input).request
							const origin = request.headers.get('origin')
							return !!origin && origin !== new URL(request.url).origin
						},
						target: 'releasing',
						actions: assign({
							response: () => failure(new CaptureError('permissionDenied', 403))
						})
					},
					{ target: 'acquiring' }
				]
			},
			acquiring: {
				invoke: {
					src: 'acquire',
					input: ({ context }) => required(required(context.input).accountId),
					onDone: {
						target: 'beforeReading',
						actions: assign({ release: ({ event }) => event.output })
					},
					onError: errors
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
					onError: errors
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
						actions: assign({
							result: ({ event }) => required<GatewayResult>(event.output)
						})
					},
					onError: errors
				}
			},
			routingResponse: {
				always: [
					{
						guard: ({ context }) => context.result?.kind === 'failed',
						target: 'releasing',
						actions: assign({
							response: ({ context }) => failure(gatewayFailure(context.result))
						})
					},
					{
						guard: ({ context }) => required(context.input).mode === 'resolve',
						target: 'encodingResolution'
					},
					{
						guard: ({ context }) => required(context.input).mode === 'asset',
						target: 'encodingAsset'
					},
					{ target: 'encodingExtraction' }
				]
			},
			encodingAsset: {
				entry: assign({
					response: ({ context }) => {
						const asset = required(gatewaySuccess(context.result).asset)
						return new Response(new Uint8Array(asset.bytes), {
							headers: { ...headers, 'Content-Type': asset.mediaType }
						})
					}
				}),
				always: 'releasing'
			},
			encodingResolution: encoding(({ context }) => {
				const result = gatewaySuccess(context.result),
					parsed = required(context.parsed)
				return {
					operationId: parsed.operationId,
					submittedUrl: parsed.url,
					finalUrl: result.finalUrl,
					redirects: result.provenance.redirects,
					resolvedAt: result.provenance.resolvedAt
				}
			}),
			encodingExtraction: encoding(({ context }) => {
				const result = gatewaySuccess(context.result)
				return {
					operationId: required(context.parsed).operationId,
					finalUrl: result.finalUrl,
					provenance: result.provenance,
					...result.extraction
				}
			}),
			releasing: {
				entry: ({ context }) => context.release?.(),
				always: '#capture-request.closed'
			}
		}
	})
	return model.createMachine({
		id: 'capture-request',
		initial: 'owning',
		context: ({ input }) => {
			const controller = new AbortController()
			return {
				input,
				controller,
				signal: AbortSignal.any([input.request.signal, controller.signal]),
				expiresAt: cap.now() + timeout,
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
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						after: { [timeout]: { target: '.timedOut' } },
						states: {
							active: { on: { CANCEL: 'cancelled' } },
							cancelled: { entry: ({ context }) => context.controller.abort() },
							timedOut: { entry: ({ context }) => context.controller.abort() }
						}
					},
					work
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
