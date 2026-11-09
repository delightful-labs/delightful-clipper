import { assign, fromPromise, setup } from 'xstate'
import { CaptureError } from '../../server/capture/errors.js'
import { sourceUrl } from '../../server/capture/destination.js'
import type { extract } from '../../server/capture/extract.js'
import type { Hop } from '../../server/capture/transport.js'
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
	hop: Hop | undefined
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
		redirect: fromPromise(async ({ input }: { input: Context }) => {
			if (!input.hop?.location) throw new CaptureError('sourceUnavailable', 502)
			const target = sourceUrl(new URL(input.hop.location, input.current).href).href
			return target
		}),
		resolve: fromPromise(({ input }: { input: Context }) =>
			capability.resolve(sourceUrl(input.current), input.signal)
		),
		fetch: fromPromise(({ input }: { input: Context }) => {
			if (!input.destination) throw new Error('Missing destination')
			return capability.fetch(sourceUrl(input.current), input.destination, input.signal, input.mode)
		}),
		extract: fromPromise(async ({ input }: { input: Context }) => {
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
		})
	}
	const model = setup<
		Context,
		{ type: 'CANCEL' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		GatewayResult
	>({ actors }).extend({
		guards: {
			aborted: ({ context }) => context.signal.aborted,
			redirectLimitReached: ({ context }, { hop }: { hop: Hop }) =>
				isRedirectResponse(hop) && context.redirects.length >= 8,
			redirectLocationMissing: (_, { hop }: { hop: Hop }) =>
				isRedirectResponse(hop) && !hop.location,
			redirectResponse: (_, { hop }: { hop: Hop }) => isRedirectResponse(hop),
			resolutionResponse: ({ context }, { hop }: { hop: Hop }) =>
				hop.status === 200 && context.mode === 'resolve',
			unsupportedAssetResponse: ({ context }, { hop }: { hop: Hop }) =>
				hop.status === 200 && context.mode === 'asset' && !isSupportedImageResponse(hop),
			assetResponse: ({ context }, { hop }: { hop: Hop }) =>
				hop.status === 200 && context.mode === 'asset',
			successfulResponse: (_, { hop }: { hop: Hop }) => hop.status === 200
		},
		actions: {
			produceResolution: assign(({ context }) => ({
				hop: undefined,
				output: {
					kind: 'success' as const,
					finalUrl: context.current,
					provenance: {
						submittedUrl: context.url,
						redirects: context.redirects,
						resolvedAt: new Date().toISOString()
					},
					extraction: undefined
				}
			})),
			produceAsset: assign(({ context }) => ({
				output: {
					kind: 'success',
					finalUrl: context.current,
					provenance: {
						submittedUrl: context.url,
						redirects: context.redirects,
						resolvedAt: new Date().toISOString()
					},
					extraction: undefined,
					asset: { bytes: context.hop!.body, mediaType: context.hop!.mediaType.split(';')[0]! }
				}
			})),
			rememberHop: assign({ hop: (_, { hop }: { hop: Hop }) => hop, destination: undefined }),
			abortFailure: assign({
				output: ({ context }): GatewayResult => ({ kind: 'failed', error: context.signal.reason })
			}),
			redirectLimitFailure: assign({
				output: (): GatewayResult => ({
					kind: 'failed',
					error: new CaptureError('redirectLoop', 400)
				})
			}),
			redirectLocationFailure: assign({
				output: (): GatewayResult => ({
					kind: 'failed',
					error: new CaptureError('sourceUnavailable', 502)
				})
			}),
			unsupportedAssetFailure: assign({
				output: (): GatewayResult => ({
					kind: 'failed',
					error: new CaptureError('unsupportedMedia', 415)
				})
			}),
			sourceFailure: assign({
				output: (): GatewayResult => ({
					kind: 'failed',
					error: new CaptureError('sourceUnavailable', 502, true)
				})
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
		on: { CANCEL: { actions: ({ context }) => context.controller.abort() } },
		output: ({ context }) => {
			if (!context.output) throw new Error('Missing gateway outcome')
			return context.output
		},
		states: {
			resolving: {
				invoke: {
					src: 'resolve',
					input: ({ context }) => context,
					onDone: {
						target: 'fetching',
						actions: assign({ destination: ({ event }) => event.output })
					},
					onError: {
						target: 'failed',
						actions: assign({ output: ({ event }) => ({ kind: 'failed', error: event.error }) })
					}
				}
			},
			fetching: {
				invoke: {
					src: 'fetch',
					input: ({ context }) => context,
					onDone: [
						{ guard: 'aborted', target: 'failed', actions: 'abortFailure' },
						{
							guard: {
								type: 'redirectLimitReached',
								params: ({ event }) => ({ hop: event.output })
							},
							target: 'failed',
							actions: 'redirectLimitFailure'
						},
						{
							guard: {
								type: 'redirectLocationMissing',
								params: ({ event }) => ({ hop: event.output })
							},
							target: 'failed',
							actions: 'redirectLocationFailure'
						},
						{
							guard: { type: 'redirectResponse', params: ({ event }) => ({ hop: event.output }) },
							target: 'redirecting',
							actions: { type: 'rememberHop', params: ({ event }) => ({ hop: event.output }) }
						},
						{
							guard: { type: 'resolutionResponse', params: ({ event }) => ({ hop: event.output }) },
							target: 'done',
							actions: [
								{ type: 'rememberHop', params: ({ event }) => ({ hop: event.output }) },
								'produceResolution'
							]
						},
						{
							guard: {
								type: 'unsupportedAssetResponse',
								params: ({ event }) => ({ hop: event.output })
							},
							target: 'failed',
							actions: 'unsupportedAssetFailure'
						},
						{
							guard: { type: 'assetResponse', params: ({ event }) => ({ hop: event.output }) },
							target: 'done',
							actions: [
								{ type: 'rememberHop', params: ({ event }) => ({ hop: event.output }) },
								'produceAsset'
							]
						},
						{
							guard: { type: 'successfulResponse', params: ({ event }) => ({ hop: event.output }) },
							target: 'extracting',
							actions: { type: 'rememberHop', params: ({ event }) => ({ hop: event.output }) }
						},
						{ target: 'failed', actions: 'sourceFailure' }
					],
					onError: {
						target: 'failed',
						actions: assign({ output: ({ event }) => ({ kind: 'failed', error: event.error }) })
					}
				}
			},
			redirecting: {
				invoke: {
					src: 'redirect',
					input: ({ context }) => context,
					onDone: [
						{
							guard: ({ context, event }) => context.visited.includes(event.output),
							target: 'failed',
							actions: assign({
								output: { kind: 'failed', error: new CaptureError('redirectLoop', 400) }
							})
						},
						{
							target: 'resolving',
							actions: assign(({ context, event }) => ({
								current: event.output,
								visited: [...context.visited, event.output],
								redirects: [
									...context.redirects,
									{ from: context.current, to: event.output, status: context.hop?.status ?? 302 }
								],
								hop: undefined
							}))
						}
					],
					onError: {
						target: 'failed',
						actions: assign({ output: ({ event }) => ({ kind: 'failed', error: event.error }) })
					}
				}
			},
			extracting: {
				invoke: {
					src: 'extract',
					input: ({ context }) => context,
					onDone: {
						target: 'done',
						actions: assign(({ context, event }) => ({
							hop: undefined,
							output: {
								kind: 'success',
								finalUrl: context.current,
								provenance: {
									submittedUrl: context.url,
									redirects: context.redirects,
									resolvedAt: new Date().toISOString()
								},
								extraction: event.output
							}
						}))
					},
					onError: {
						target: 'failed',
						actions: assign({ output: ({ event }) => ({ kind: 'failed', error: event.error }) })
					}
				}
			},
			done: { type: 'final', entry: assign({ hop: undefined, destination: undefined }) },
			failed: { type: 'final', entry: assign({ hop: undefined, destination: undefined }) }
		}
	})
}
