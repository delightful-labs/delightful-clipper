import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic } from 'xstate'

import { CaptureError } from '../../server/capture/errors.js'
import { sourceUrl } from '../../server/capture/destination.js'
import type { extract } from '../../server/capture/extract.js'
import type { Hop } from '../../server/capture/transport.js'
type ObservedHop = Hop & { observedAt: string }
type Destination = { address: string; family: number }
type Redirect = { from: string; to: string; status: number }
type Extraction = Awaited<ReturnType<typeof extract>>
export type GatewayResult =
	| {
			kind: 'success'
			finalUrl: string
			provenance: { submittedUrl: string; redirects: Redirect[]; resolvedAt: string }
			extraction: Extraction | undefined
			asset?: { bytes: Uint8Array; mediaType: string }
	  }
	| { kind: 'failed'; error: unknown }
export type GatewayInput = {
	url: string
	signal: AbortSignal
	mode: 'resolve' | 'extract' | 'asset'
}
type Input = GatewayInput
type Context = Input & {
	controller: AbortController
	current: string
	visited: string[]
	redirects: Redirect[]
	destination: Destination | undefined
	hop: ObservedHop | undefined
	output: GatewayResult | undefined
}
function isSupportedImageResponse(hop: Hop | undefined) {
	if (!hop || hop.body.byteLength > 4 * 1024 * 1024) return false
	return /^image\/(png|jpeg|webp|gif)(;|$)/i.test(hop.mediaType)
}
function isRedirectResponse(hop: Hop) {
	return [301, 302, 303, 307, 308].includes(hop.status)
}
export function createGatewayMachine(capability: {
	resolve: (url: URL, signal: AbortSignal) => Promise<Destination>
	fetch: (
		url: URL,
		destination: Destination,
		signal: AbortSignal,
		mode?: 'resolve' | 'extract' | 'asset'
	) => Promise<Hop>
	extract: (
		body: Uint8Array,
		mediaType: string,
		url: string,
		signal: AbortSignal
	) => Extraction | Promise<Extraction>
}) {
	const actors = {
		redirect: createAsyncLogic({
			run: async ({ input }: { input: Context }) => {
				if (!input.hop?.location) throw new CaptureError('sourceUnavailable', 502)
				const target = sourceUrl(new URL(input.hop.location, input.current).href).href
				return target
			}
		}),
		resolve: createAsyncLogic({
			run: ({ input }: { input: Context }) =>
				capability.resolve(sourceUrl(input.current), input.signal)
		}),
		fetch: createAsyncLogic({
			run: async ({ input }: { input: Context }) => {
				if (!input.destination) throw new Error('Missing destination')
				const hop = await capability.fetch(
					sourceUrl(input.current),
					input.destination,
					input.signal,
					input.mode
				)
				return { ...hop, observedAt: new Date().toISOString() }
			}
		}),
		extract: createAsyncLogic({
			run: async ({ input }: { input: Context }) => {
				input.signal.throwIfAborted()
				if (!input.hop) throw new Error('Missing response')
				try {
					return await capability.extract(
						input.hop.body,
						input.hop.mediaType,
						input.current,
						input.signal
					)
				} catch (error) {
					throw error instanceof CaptureError ? error : new CaptureError('parseFailed', 422)
				}
			}
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: { CANCEL: types<EventPayload<{ type: 'CANCEL' }, 'CANCEL'>>() },
			input: types<Input>(),
			output: types<GatewayResult>(),
			tags: types<string>(),
			children: {
				redirect: types<import('xstate').ActorRefFrom<(typeof actors)['redirect']>>(),
				resolve: types<import('xstate').ActorRefFrom<(typeof actors)['resolve']>>(),
				fetch: types<import('xstate').ActorRefFrom<(typeof actors)['fetch']>>(),
				extract: types<import('xstate').ActorRefFrom<(typeof actors)['extract']>>()
			}
		},
		actors,
		guards: {
			aborted: ({ context }: { context: Context }) => context.signal.aborted,
			redirectLimitReached: ({ context }: { context: Context }, { hop }: { hop: Hop }) =>
				isRedirectResponse(hop) && context.redirects.length >= 8,
			redirectLocationMissing: (_: { context: Context }, { hop }: { hop: Hop }) =>
				isRedirectResponse(hop) && !hop.location,
			redirectResponse: (_: { context: Context }, { hop }: { hop: Hop }) => isRedirectResponse(hop),
			resolutionResponse: ({ context }: { context: Context }, { hop }: { hop: Hop }) =>
				hop.status === 200 && context.mode === 'resolve',
			unsupportedAssetResponse: ({ context }: { context: Context }, { hop }: { hop: Hop }) =>
				hop.status === 200 && context.mode === 'asset' && !isSupportedImageResponse(hop),
			assetResponse: ({ context }: { context: Context }, { hop }: { hop: Hop }) =>
				hop.status === 200 && context.mode === 'asset',
			successfulResponse: (_: { context: Context }, { hop }: { hop: Hop }) => hop.status === 200
		},
		actions: {
			produceResolution: ({
				context
			}: {
				context: Context
			}): { context: Pick<Context, 'hop' | 'output'> } => ({
				context: {
					hop: undefined,
					output: {
						kind: 'success',
						finalUrl: context.current,
						provenance: {
							submittedUrl: context.url,
							redirects: context.redirects,
							resolvedAt: context.hop!.observedAt
						},
						extraction: undefined
					}
				}
			}),
			produceAsset: ({ context }: { context: Context }): { context: Pick<Context, 'output'> } => ({
				context: {
					output: {
						kind: 'success',
						finalUrl: context.current,
						provenance: {
							submittedUrl: context.url,
							redirects: context.redirects,
							resolvedAt: context.hop!.observedAt
						},
						extraction: undefined,
						asset: { bytes: context.hop!.body, mediaType: context.hop!.mediaType.split(';')[0]! }
					}
				}
			}),
			rememberHop: (args: { context: Context }, params: { hop: ObservedHop }) => ({
				context: {
					hop: ((_, { hop }: { hop: ObservedHop }) => hop)(args, params),
					destination: undefined
				}
			}),
			abortFailure: ({ context }: { context: Context }): { context: Pick<Context, 'output'> } => ({
				context: { output: { kind: 'failed', error: context.signal.reason } }
			}),
			redirectLimitFailure: (): { context: Pick<Context, 'output'> } => ({
				context: {
					output: {
						kind: 'failed',
						error: new CaptureError('redirectLoop', 400)
					}
				}
			}),
			redirectLocationFailure: (): { context: Pick<Context, 'output'> } => ({
				context: {
					output: {
						kind: 'failed',
						error: new CaptureError('sourceUnavailable', 502)
					}
				}
			}),
			unsupportedAssetFailure: (): { context: Pick<Context, 'output'> } => ({
				context: {
					output: {
						kind: 'failed',
						error: new CaptureError('unsupportedMedia', 415)
					}
				}
			}),
			sourceFailure: (): { context: Pick<Context, 'output'> } => ({
				context: {
					output: {
						kind: 'failed',
						error: new CaptureError('sourceUnavailable', 502, true)
					}
				}
			})
		}
	})
	return model.createMachine({
		id: 'capture-gateway',
		initial: 'resolving',
		context: ({ input }) => {
			const controller = new AbortController()
			return {
				...input,
				signal: AbortSignal.any([input.signal, controller.signal]),
				controller,
				current: input.url,
				visited: [input.url],
				redirects: [],
				destination: undefined,
				hop: undefined,
				output: undefined
			}
		},
		on: {
			CANCEL: (args, enq) => {
				enq(() => args.context.controller.abort())
			}
		},
		output: ({ context }) => {
			if (!context.output) throw new Error('Missing gateway outcome')
			return context.output
		},
		states: {
			resolving: {
				invoke: {
					id: 'resolve',
					src: 'resolve',
					input: ({ context }: { context: Context }) => context,
					onDone: (args) => {
						return { target: 'fetching', context: { destination: args.event.output } }
					},
					onError: (args) => {
						return {
							target: 'failed',
							context: { output: { kind: 'failed', error: args.event.error } }
						}
					}
				}
			},
			fetching: {
				invoke: {
					id: 'fetch',
					src: 'fetch',
					input: ({ context }: { context: Context }) => context,
					onDone: (args) => {
						const { event } = args
						if (args.guards.aborted(args)) {
							return { target: 'failed', context: args.actions.abortFailure(args).context }
						}
						if (args.guards.redirectLimitReached(args, { hop: event.output })) {
							return { target: 'failed', context: args.actions.redirectLimitFailure().context }
						}
						if (args.guards.redirectLocationMissing(args, { hop: event.output })) {
							return { target: 'failed', context: args.actions.redirectLocationFailure().context }
						}
						if (args.guards.redirectResponse(args, { hop: event.output })) {
							return {
								target: 'redirecting',
								context: args.actions.rememberHop(args, { hop: event.output }).context
							}
						}
						if (args.guards.resolutionResponse(args, { hop: event.output })) {
							let context = args.context
							let patch = {}
							patch = { ...patch, ...args.actions.rememberHop(args, { hop: event.output }).context }
							context = { ...args.context, ...patch }
							patch = { ...patch, ...args.actions.produceResolution({ ...args, context }).context }
							context = { ...args.context, ...patch }
							return { target: 'done', context: patch }
						}
						if (args.guards.unsupportedAssetResponse(args, { hop: event.output })) {
							return { target: 'failed', context: args.actions.unsupportedAssetFailure().context }
						}
						if (args.guards.assetResponse(args, { hop: event.output })) {
							let context = args.context
							let patch = {}
							patch = { ...patch, ...args.actions.rememberHop(args, { hop: event.output }).context }
							context = { ...args.context, ...patch }
							patch = { ...patch, ...args.actions.produceAsset({ ...args, context }).context }
							context = { ...args.context, ...patch }
							return { target: 'done', context: patch }
						}
						if (args.guards.successfulResponse(args, { hop: event.output })) {
							return {
								target: 'extracting',
								context: args.actions.rememberHop(args, { hop: event.output }).context
							}
						}
						return { target: 'failed', context: args.actions.sourceFailure().context }
					},
					onError: (args) => {
						return {
							target: 'failed',
							context: { output: { kind: 'failed', error: args.event.error } }
						}
					}
				}
			},
			redirecting: {
				invoke: {
					id: 'redirect',
					src: 'redirect',
					input: ({ context }: { context: Context }) => context,
					onDone: (args) => {
						const { context, event } = args
						if (context.visited.includes(event.output)) {
							return {
								target: 'failed',
								context: {
									output: { kind: 'failed', error: new CaptureError('redirectLoop', 400) }
								}
							}
						}
						return {
							target: 'resolving',
							context: {
								current: event.output,
								visited: [...context.visited, event.output],
								redirects: [
									...context.redirects,
									{ from: context.current, to: event.output, status: context.hop?.status ?? 302 }
								],
								hop: undefined
							}
						}
					},
					onError: (args) => {
						return {
							target: 'failed',
							context: { output: { kind: 'failed', error: args.event.error } }
						}
					}
				}
			},
			extracting: {
				invoke: {
					id: 'extract',
					src: 'extract',
					input: ({ context }: { context: Context }) => context,
					onDone: (args) => {
						const { context } = args
						return {
							target: 'done',
							context: {
								hop: undefined,
								output: {
									kind: 'success',
									finalUrl: context.current,
									provenance: {
										submittedUrl: context.url,
										redirects: context.redirects,
										resolvedAt: context.hop!.observedAt
									},
									extraction: args.event.output
								}
							}
						}
					},
					onError: (args) => {
						return {
							target: 'failed',
							context: { output: { kind: 'failed', error: args.event.error } }
						}
					}
				}
			},
			done: {
				type: 'final',
				entry: () => {
					return { context: { hop: undefined, destination: undefined } }
				}
			},
			failed: {
				type: 'final',
				entry: () => {
					return { context: { hop: undefined, destination: undefined } }
				}
			}
		}
	})
}
