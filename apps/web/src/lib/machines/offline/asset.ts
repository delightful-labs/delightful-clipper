import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic } from 'xstate'

type Input = {
	reuse: () => Promise<Response | undefined>
	fetch: () => Promise<Response>
	valid: (response: Response) => boolean
	store: (response: Response) => Promise<void>
}
type Context = { port: Input; response: Response | undefined; result: 'ready' | 'failed' }
const response = (context: Context) => {
	if (!context.response) throw new Error('Missing shell response')
	return context.response
}
const actors = {
	reuse: createAsyncLogic({ run: ({ input }: { input: Input }) => input.reuse() }),
	fetch: createAsyncLogic({ run: ({ input }: { input: Input }) => input.fetch() }),
	store: createAsyncLogic({
		run: ({ input }: { input: Context }) => input.port.store(response(input))
	}),
	discard: createAsyncLogic({
		run: async ({ input }: { input: Context }) => response(input).body?.cancel()
	})
}
const shellAssetModel = setup({
	schemas: {
		context: types<Context>(),
		events: { UNUSED: types<EventPayload<{ type: 'UNUSED' }, 'UNUSED'>>() },
		input: types<Input>(),
		output: types<'ready' | 'failed'>(),
		tags: types<string>(),
		children: {
			reuse: types<import('xstate').ActorRefFrom<(typeof actors)['reuse']>>(),
			fetch: types<import('xstate').ActorRefFrom<(typeof actors)['fetch']>>(),
			store: types<import('xstate').ActorRefFrom<(typeof actors)['store']>>(),
			discard: types<import('xstate').ActorRefFrom<(typeof actors)['discard']>>()
		}
	},
	actors,
	guards: {
		responsePresent: (_: { context: Context }, params: { response: Response | undefined }) =>
			!!params.response,
		validResponse: (
			{ context }: { context: Context },
			params: { response: Response | undefined }
		) => !!params.response && context.port.valid(params.response)
	}
})
export const shellAssetMachine = shellAssetModel.createMachine({
	id: 'shell-asset',
	context: ({ input }) => ({ port: input, response: undefined, result: 'failed' }),
	initial: 'checkingCache',
	output: ({ context }) => context.result,
	states: {
		checkingCache: {
			invoke: {
				id: 'reuse',
				src: 'reuse',
				input: ({ context }: { context: Context }) => context.port,
				onDone: (args) => {
					const { event } = args
					if (args.guards.validResponse(args, { response: event.output })) {
						return { target: 'storing', context: { response: event.output } }
					}
					if (args.guards.responsePresent(args, { response: event.output })) {
						return { target: 'discarding', context: { response: event.output } }
					}
					return { target: 'fetching' }
				},
				onError: { target: 'failed' }
			}
		},
		fetching: {
			invoke: {
				id: 'fetch',
				src: 'fetch',
				input: ({ context }: { context: Context }) => context.port,
				onDone: (args) => {
					const { event } = args
					if (args.guards.validResponse(args, { response: event.output })) {
						return { target: 'storing', context: { response: event.output } }
					}
					return { target: 'discarding', context: { response: event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		discarding: {
			invoke: {
				id: 'discard',
				src: 'discard',
				input: ({ context }: { context: Context }) => context,
				onDone: { target: 'failed' },
				onError: { target: 'failed' }
			}
		},
		storing: {
			invoke: {
				id: 'store',
				src: 'store',
				input: ({ context }: { context: Context }) => context,
				onDone: { target: 'ready' },
				onError: { target: 'failed' }
			}
		},
		ready: {
			type: 'final',
			entry: () => {
				return { context: { response: undefined, result: 'ready' } }
			}
		},
		failed: {
			type: 'final',
			entry: () => {
				return { context: { response: undefined } }
			}
		}
	}
})

type ReadInput = { cached: () => Promise<Response | undefined>; fetch: () => Promise<Response> }
type ReadContext = { port: ReadInput; response: Response | undefined; error: unknown }
const readActors = {
	cached: createAsyncLogic({ run: ({ input }: { input: ReadInput }) => input.cached() }),
	fetch: createAsyncLogic({ run: ({ input }: { input: ReadInput }) => input.fetch() })
}
/** Runtime cache misses use network without writing runtime responses into the shell cache. */
const shellReadModel = setup({
	schemas: {
		context: types<ReadContext>(),
		events: { UNUSED: types<EventPayload<{ type: 'UNUSED' }, 'UNUSED'>>() },
		input: types<ReadInput>(),
		output: types<{ response: Response | undefined; error: unknown }>(),
		tags: types<string>(),
		children: {
			cached: types<import('xstate').ActorRefFrom<(typeof readActors)['cached']>>(),
			fetch: types<import('xstate').ActorRefFrom<(typeof readActors)['fetch']>>()
		}
	},
	actors: readActors,
	guards: {
		responsePresent: (_: { context: ReadContext }, params: { response: Response | undefined }) =>
			!!params.response
	}
})
export const shellReadMachine = shellReadModel.createMachine({
	id: 'shell-read',
	context: ({ input }) => ({ port: input, response: undefined, error: undefined }),
	initial: 'checkingCache',
	output: ({ context }) => ({ response: context.response, error: context.error }),
	states: {
		checkingCache: {
			invoke: {
				id: 'cached',
				src: 'cached',
				input: ({ context }: { context: ReadContext }) => context.port,
				onDone: (args) => {
					const { event } = args
					if (args.guards.responsePresent(args, { response: event.output })) {
						return { target: 'done', context: { response: event.output } }
					}
					return { target: 'fetching' }
				},
				onError: (args) => {
					return { target: 'done', context: { error: args.event.error } }
				}
			}
		},
		fetching: {
			invoke: {
				id: 'fetch',
				src: 'fetch',
				input: ({ context }: { context: ReadContext }) => context.port,
				onDone: (args) => {
					return { target: 'done', context: { response: args.event.output } }
				},
				onError: (args) => {
					return { target: 'done', context: { error: args.event.error } }
				}
			}
		},
		done: { type: 'final' }
	}
})
