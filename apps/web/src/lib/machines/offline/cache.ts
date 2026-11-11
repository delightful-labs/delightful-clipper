import { types, setup, createAsyncLogic } from 'xstate'

type Port = {
	populate: () => Promise<void>
	discard: () => Promise<void>
	obsolete: () => Promise<string[]>
	remove: (names: string[]) => Promise<void>
	claim: () => Promise<void>
}
type Context = {
	mode: 'install' | 'activate'
	port: Port | undefined
	names: string[]
	cleanupFailed: boolean
	result: 'ready' | 'failed'
}
type Input = { mode: 'install' | 'activate'; port: Port }
const actors = {
	populate: createAsyncLogic({ run: ({ input }: { input: Port }) => input.populate() }),
	discard: createAsyncLogic({ run: ({ input }: { input: Port }) => input.discard() }),
	obsolete: createAsyncLogic({ run: ({ input }: { input: Port }) => input.obsolete() }),
	remove: createAsyncLogic({
		run: ({ input }: { input: { port: Port; names: string[] } }) => input.port.remove(input.names)
	}),
	claim: createAsyncLogic({ run: ({ input }: { input: Port }) => input.claim() })
}
function port(context: Context) {
	if (!context.port) throw new Error('Missing shell cache port')
	return context.port
}
const input = ({ context }: { context: Context }) => port(context)
export const shellCacheMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {},
		input: types<Input>(),
		output: types<'ready' | 'failed'>(),
		tags: types<string>(),
		children: {
			populate: types<import('xstate').ActorRefFrom<(typeof actors)['populate']>>(),
			discard: types<import('xstate').ActorRefFrom<(typeof actors)['discard']>>(),
			obsolete: types<import('xstate').ActorRefFrom<(typeof actors)['obsolete']>>(),
			remove: types<import('xstate').ActorRefFrom<(typeof actors)['remove']>>(),
			claim: types<import('xstate').ActorRefFrom<(typeof actors)['claim']>>()
		}
	},
	actors
}).createMachine({
	id: 'shell-cache',
	initial: 'route',
	context: ({ input }) => ({
		port: input.port,
		names: [],
		cleanupFailed: false,
		result: 'failed',
		mode: input.mode
	}),
	output: ({ context }) => context.result,
	states: {
		route: {
			type: 'choice',
			choice: (args) => {
				if (args.context.mode === 'install') {
					return { target: 'populating' }
				}
				return { target: 'listing' }
			}
		},
		populating: {
			invoke: {
				id: 'populate',
				src: 'populate',
				input,
				onDone: { target: 'ready' },
				onError: { target: 'discarding' }
			}
		},
		discarding: {
			invoke: {
				id: 'discard',
				src: 'discard',
				input,
				onDone: { target: 'failed' },
				onError: { target: 'failed' }
			}
		},
		listing: {
			invoke: {
				id: 'obsolete',
				src: 'obsolete',
				input,
				onDone: (args) => {
					return { target: 'removing', context: { names: args.event.output } }
				},
				onError: () => {
					return { target: 'claiming', context: { cleanupFailed: true } }
				}
			}
		},
		removing: {
			invoke: {
				id: 'remove',
				src: 'remove',
				input: ({ context }: { context: Context }) => ({
					port: port(context),
					names: context.names
				}),
				onDone: { target: 'claiming' },
				onError: () => {
					return { target: 'claiming', context: { cleanupFailed: true } }
				}
			}
		},
		claiming: {
			invoke: {
				id: 'claim',
				src: 'claim',
				input,
				onDone: { target: 'ready' },
				onError: { target: 'failed' }
			}
		},
		ready: {
			type: 'final',
			entry: () => {
				return { context: { result: 'ready', port: undefined, names: [] } }
			}
		},
		failed: {
			type: 'final',
			entry: () => {
				return { context: { result: 'failed', port: undefined, names: [] } }
			}
		}
	}
})
