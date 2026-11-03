import { assign, fromPromise, setup } from 'xstate'
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
	populate: fromPromise(({ input }: { input: Port }) => input.populate()),
	discard: fromPromise(({ input }: { input: Port }) => input.discard()),
	obsolete: fromPromise(({ input }: { input: Port }) => input.obsolete()),
	remove: fromPromise(({ input }: { input: { port: Port; names: string[] } }) =>
		input.port.remove(input.names)
	),
	claim: fromPromise(({ input }: { input: Port }) => input.claim())
}
function port(context: Context) {
	if (!context.port) throw new Error('Missing shell cache port')
	return context.port
}
const input = ({ context }: { context: Context }) => port(context)
export const shellCacheMachine = setup<
	Context,
	{ type: 'UNUSED' },
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	Input,
	'ready' | 'failed'
>({ actors }).createMachine({
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
			always: [
				{ guard: ({ context }) => context.mode === 'install', target: 'populating' },
				{ target: 'listing' }
			]
		},
		populating: { invoke: { src: 'populate', input, onDone: 'ready', onError: 'discarding' } },
		discarding: { invoke: { src: 'discard', input, onDone: 'failed', onError: 'failed' } },
		listing: {
			invoke: {
				src: 'obsolete',
				input,
				onDone: { target: 'removing', actions: assign({ names: ({ event }) => event.output }) },
				onError: { target: 'claiming', actions: assign({ cleanupFailed: true }) }
			}
		},
		removing: {
			invoke: {
				src: 'remove',
				input: ({ context }) => ({ port: port(context), names: context.names }),
				onDone: 'claiming',
				onError: { target: 'claiming', actions: assign({ cleanupFailed: true }) }
			}
		},
		claiming: { invoke: { src: 'claim', input, onDone: 'ready', onError: 'failed' } },
		ready: { type: 'final', entry: assign({ result: 'ready', port: undefined, names: [] }) },
		failed: { type: 'final', entry: assign({ result: 'failed', port: undefined, names: [] }) }
	}
})
