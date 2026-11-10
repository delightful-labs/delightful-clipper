import type { EventPayload } from '../events.js'
import {
	types,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	type ActorLogic,
	type Snapshot,
	matchesState
} from 'xstate'

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
type RequestResources = { controller: AbortController; signal: AbortSignal; expiresAt: number }
type Interruption = { timedOut: boolean; cancelled: boolean }
export function createCaptureRequestMachine<G extends Snapshot<GatewayResult>>(
	cap: RequestCapability<G>
) {
	type Context = {
		input: RequestInput | undefined
		resources: RequestResources | undefined
		error: unknown
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
		resources: createCallbackLogic<{ type: 'UNUSED' }, Request>(({ input, sendBack }) => {
			const controller = new AbortController()
			const signal = AbortSignal.any([input.signal, controller.signal])
			sendBack({ type: 'READY', resources: { controller, signal, expiresAt: cap.now() + timeout } })
			return () => controller.abort()
		}),
		checkpoint: createAsyncLogic({
			run: async ({ input }: { input: RequestResources }): Promise<Interruption> => ({
				timedOut: cap.now() >= input.expiresAt,
				cancelled: input.signal.aborted
			})
		}),
		cancellation: createCallbackLogic<{ type: 'UNUSED' }, AbortSignal>(({ input, sendBack }) => {
			const abort = () => sendBack({ type: 'CANCEL' })
			input.addEventListener('abort', abort, { once: true })
			if (input.aborted) abort()
			return () => input.removeEventListener('abort', abort)
		}),

		acquire: createAsyncLogic({ run: async ({ input }: { input: string }) => cap.acquire(input) }),
		read: createAsyncLogic({
			run: ({ input }: { input: { request: Request; signal: AbortSignal } }) =>
				cap.read(input.request, input.signal)
		}),
		gateway: cap.gateway,
		encode: createAsyncLogic({
			run: async ({ input }: { input: unknown }) => {
				const payload = JSON.stringify(input)
				if (new TextEncoder().encode(payload).length > 5 * 1024 * 1024)
					throw new CaptureError('sourceTooLarge', 413)
				return new Response(payload, { headers })
			}
		})
	}
	type FullContext = Context & {
		result: GatewayResult | undefined
		ownedGateway:
			| import('xstate').ActorInstance<import('xstate').Snapshot<GatewayResult>, { type: 'CANCEL' }>
			| undefined
	}
	const model = setup({
		schemas: {
			context: types<FullContext>(),
			events: {
				GATEWAY_DONE: types<{ actorId: string; output: GatewayResult }>(),
				GATEWAY_ERROR: types<{ actorId: string; error: unknown }>(),
				CANCEL: types<EventPayload<{ type: 'CANCEL' }, 'CANCEL'>>(),
				READY: types<{ resources: RequestResources }>()
			},
			input: types<RequestInput>(),
			output: types<Response>(),
			tags: types<string>(),
			children: {
				resources: types<import('xstate').ActorRefFrom<typeof actors.resources>>(),
				checkpoint: types<import('xstate').ActorRefFrom<typeof actors.checkpoint>>(),
				cancellation: types<import('xstate').ActorRefFrom<(typeof actors)['cancellation']>>(),
				acquire: types<import('xstate').ActorRefFrom<(typeof actors)['acquire']>>(),
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				encode: types<import('xstate').ActorRefFrom<(typeof actors)['encode']>>()
			}
		},
		actors,
		actions: {
			recordFailure: ({ event }: { event: { type: string; error?: unknown } }) => ({
				context: { response: failure('error' in event ? event.error : undefined) }
			}),
			produceAssetResponse: (args: { context: FullContext }, _params?: undefined) => ({
				context: {
					response: (({ context }) => {
						const asset = required(gatewaySuccess(context.result).asset)
						return new Response(new Uint8Array(asset.bytes), {
							headers: { ...headers, 'Content-Type': asset.mediaType }
						})
					})(args)
				}
			}),
			produceCancelledResponse: () => ({
				context: { response: failure(new CaptureError('canceled', 408, true)) }
			}),
			produceTimeoutResponse: () => ({
				context: { response: failure(new CaptureError('fetchTimeout', 504, true)) }
			})
		},
		guards: {
			timedOut: ({ value }: { value: import('xstate').StateValue }, observed: Interruption) =>
				matchesState({ owning: { control: 'timedOut' } }, value) || observed.timedOut,
			cancelled: ({ value }: { value: import('xstate').StateValue }, observed: Interruption) =>
				matchesState({ owning: { control: 'cancelled' } }, value) || observed.cancelled
		}
	})

	const errors = ({ event }: { event: { error: unknown } }) => ({
		target: '#request-checking-failure',
		context: { error: event.error }
	})

	const encoding = (payload: (args: { context: FullContext }) => unknown) =>
		model.createStateConfig({
			invoke: {
				id: 'encode',
				src: 'encode',
				input: payload,
				onDone: ({ event }) => ({
					target: 'beforeResponse',
					context: { response: event.output }
				}),
				onError: errors
			}
		})

	const interruptedStage = (next: 'reading' | 'capturing' | 'routingResponse' | 'releasing') =>
		model.createStateConfig({
			invoke: {
				id: 'checkpoint',
				src: 'checkpoint',
				input: ({ context }: { context: FullContext }) => required(context.resources),
				onDone: (args: { value: import('xstate').StateValue; event: { output: Interruption } }) => {
					if (
						matchesState({ owning: { control: 'timedOut' } }, args.value) ||
						args.event.output.timedOut
					)
						return {
							target: '#request-releasing',
							context: { response: failure(new CaptureError('fetchTimeout', 504, true)) }
						}
					if (
						matchesState({ owning: { control: 'cancelled' } }, args.value) ||
						args.event.output.cancelled
					)
						return {
							target: '#request-releasing',
							context: { response: failure(new CaptureError('canceled', 408, true)) }
						}
					return { target: next }
				},
				onError: ({ event }: { event: { error: unknown } }) => ({
					target: '#request-releasing',
					context: { response: failure(event.error) }
				})
			}
		})

	return model.createMachine({
		id: 'capture-request',
		initial: 'initializing',
		context: ({ input }) => ({
			input,
			resources: undefined,
			error: undefined,
			release: undefined,
			parsed: undefined,
			response: undefined,
			result: undefined,
			ownedGateway: undefined
		}),
		invoke: {
			id: 'resources',
			src: 'resources',
			input: ({ context }) => required(context.input).request
		},
		output: ({ context }) => required(context.response),
		states: {
			initializing: {
				on: {
					READY: ({ event }) => ({ target: 'owning', context: { resources: event.resources } })
				}
			},
			owning: {
				invoke: {
					id: 'cancellation',
					src: 'cancellation',
					input: ({ context }: { context: FullContext }) => required(context.input).request.signal
				},
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						after: { [timeout]: { target: '.timedOut' } },
						states: {
							active: { on: { CANCEL: { target: 'cancelled' } } },
							cancelled: {
								entry: ({ context }, enq) => {
									enq(() => required(context.resources).controller.abort())
								}
							},
							timedOut: {
								entry: ({ context }, enq) => {
									enq(() => required(context.resources).controller.abort())
								}
							}
						}
					},
					work: {
						initial: 'authorizing',
						states: {
							beforeReading: interruptedStage('reading'),
							beforeCapturing: interruptedStage('capturing'),
							beforeEncoding: interruptedStage('routingResponse'),
							beforeResponse: interruptedStage('releasing'),
							checkingFailure: {
								id: 'request-checking-failure',
								invoke: {
									id: 'checkpoint',
									src: 'checkpoint',
									input: ({ context }) => required(context.resources),
									onDone: (args) => {
										if (args.context.error instanceof CaptureError)
											return {
												target: 'releasing',
												context: { response: failure(args.context.error) }
											}
										if (args.guards.timedOut(args, args.event.output))
											return { target: 'releasing', ...args.actions.produceTimeoutResponse() }
										if (args.guards.cancelled(args, args.event.output))
											return { target: 'releasing', ...args.actions.produceCancelledResponse() }
										return {
											target: 'releasing',
											context: { response: failure(args.context.error) }
										}
									},
									onError: ({ event }) => ({
										target: 'releasing',
										context: { response: failure(event.error) }
									})
								}
							},
							authorizing: {
								always: (args) => {
									const { context } = args
									if (!required(context.input).accountId) {
										return {
											target: 'releasing',
											context: { response: failure(new CaptureError('sessionUnavailable', 401)) }
										}
									}
									if (!required(context.input).enabled) {
										return {
											target: 'releasing',
											context: {
												response: failure(new CaptureError('gatewayUnavailable', 503, true))
											}
										}
									}
									if (
										(({ context }) => {
											const request = required(context.input).request
											const origin = request.headers.get('origin')
											return !!origin && origin !== new URL(request.url).origin
										})(args)
									) {
										return {
											target: 'releasing',
											context: { response: failure(new CaptureError('permissionDenied', 403)) }
										}
									}
									return { target: 'acquiring' }
								}
							},
							acquiring: {
								invoke: {
									id: 'acquire',
									src: 'acquire',
									input: ({ context }: { context: FullContext }) =>
										required(required(context.input).accountId),
									onDone: (args) => {
										return { target: 'beforeReading', context: { release: args.event.output } }
									},
									onError: errors
								}
							},
							reading: {
								invoke: {
									id: 'read',
									src: 'read',
									input: ({ context }: { context: FullContext }) => ({
										request: required(context.input).request,
										signal: required(context.resources).signal
									}),
									onDone: (args) => {
										return { target: 'beforeCapturing', context: { parsed: args.event.output } }
									},
									onError: errors
								}
							},
							capturing: {
								entry: (args, enq) => {
									const ref = enq.spawn('gateway', {
										id: 'gateway',
										input: (({ context }: { context: FullContext }) => ({
											url: required(context.parsed).url,
											mode: required(context.input).mode,
											signal: required(context.resources).signal
										}))(args)
									})
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| { type: 'GATEWAY_DONE'; actorId: string; output: GatewayResult }
											| { type: 'GATEWAY_ERROR'; actorId: string; error: unknown } => ({
											type: 'GATEWAY_DONE',
											actorId: ref.id,
											output: required<GatewayResult>(output)
										}),
										error: (
											error
										):
											| { type: 'GATEWAY_DONE'; actorId: string; output: GatewayResult }
											| { type: 'GATEWAY_ERROR'; actorId: string; error: unknown } => ({
											type: 'GATEWAY_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedGateway: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedGateway)
									return { context: { ownedGateway: undefined } }
								},
								on: {
									GATEWAY_DONE: (args) => {
										return {
											target: 'beforeEncoding',
											context: { result: required<GatewayResult>(args.event.output) }
										}
									},
									GATEWAY_ERROR: errors
								}
							},
							routingResponse: {
								always: (args) => {
									const { context } = args
									if (context.result?.kind === 'failed') {
										return {
											target: 'releasing',
											context: { response: failure(gatewayFailure(context.result)) }
										}
									}
									if (required(context.input).mode === 'resolve') {
										return { target: 'encodingResolution' }
									}
									if (required(context.input).mode === 'asset') {
										return {
											target: 'releasing',
											context: args.actions.produceAssetResponse(args).context
										}
									}
									return { target: 'encodingExtraction' }
								}
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
								id: 'request-releasing',
								entry: ({ context }, enq) => {
									enq(() => context.release?.())
								},
								always: { target: '#capture-request.closed' }
							}
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return {
						context: { input: undefined, release: undefined, parsed: undefined, result: undefined }
					}
				}
			}
		}
	})
}
