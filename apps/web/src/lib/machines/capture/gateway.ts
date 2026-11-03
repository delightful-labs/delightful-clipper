import { assign, fromPromise, setup } from 'xstate'
import { CaptureError } from '../../server/capture/errors.js'
import { sourceUrl } from '../../server/capture/destination.js'
import type { extract } from '../../server/capture/extract.js'
import type { Hop } from '../../server/capture/transport.js'
type Destination = { address: string; family: number }
type Redirect = { from: string; to: string; status: number }
type Extraction = ReturnType<typeof extract>
export type GatewayResult =
	| {
			kind: 'success'
			finalUrl: string
			provenance: { submittedUrl: string; redirects: Redirect[]; resolvedAt: string }
			extraction: Extraction | undefined
	  }
	| { kind: 'failed'; error: unknown }
type Input = { url: string; signal: AbortSignal; mode: 'resolve' | 'extract' }
type Context = Input & {
	controller: AbortController
	current: string
	visited: string[]
	redirects: Redirect[]
	destination: Destination | undefined
	hop: Hop | undefined
	output: GatewayResult | undefined
}
export function createGatewayMachine(capability: {
	resolve: (url: URL, signal: AbortSignal) => Promise<Destination>
	fetch: (url: URL, destination: Destination, signal: AbortSignal) => Promise<Hop>
	extract: (body: Uint8Array, mediaType: string, url: string) => Extraction
}) {
	const actors = {
		redirect: fromPromise(async ({ input }: { input: Context }) => {
			if (input.redirects.length >= 8) throw new CaptureError('redirectLoop', 400)
			if (!input.hop?.location) throw new CaptureError('sourceUnavailable', 502)
			const target = sourceUrl(new URL(input.hop.location, input.current).href).href
			if (input.visited.includes(target)) throw new CaptureError('redirectLoop', 400)
			return target
		}),
		resolve: fromPromise(({ input }: { input: Context }) =>
			capability.resolve(sourceUrl(input.current), input.signal)
		),
		fetch: fromPromise(({ input }: { input: Context }) => {
			if (!input.destination) throw new Error('Missing destination')
			return capability.fetch(sourceUrl(input.current), input.destination, input.signal)
		}),
		extract: fromPromise(async ({ input }: { input: Context }) => {
			input.signal.throwIfAborted()
			if (!input.hop) throw new Error('Missing response')
			if (input.mode === 'resolve') return undefined
			try {
				return capability.extract(input.hop.body, input.hop.mediaType, input.current)
			} catch (error) {
				throw error instanceof CaptureError ? error : new CaptureError('parseFailed', 422)
			}
		})
	}
	return setup<
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
	>({ actors }).createMachine({
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
					onDone: {
						target: 'routing',
						actions: assign({ hop: ({ event }) => event.output, destination: undefined })
					},
					onError: {
						target: 'failed',
						actions: assign({ output: ({ event }) => ({ kind: 'failed', error: event.error }) })
					}
				}
			},
			routing: {
				always: [
					{
						guard: ({ context }) => [301, 302, 303, 307, 308].includes(context.hop?.status ?? 0),
						target: 'redirecting'
					},
					{ guard: ({ context }) => context.hop?.status === 200, target: 'extracting' },
					{
						target: 'failed',
						actions: assign({
							output: { kind: 'failed', error: new CaptureError('sourceUnavailable', 502, true) }
						})
					}
				]
			},
			redirecting: {
				invoke: {
					src: 'redirect',
					input: ({ context }) => context,
					onDone: {
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
					},
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
