import { assign, fromPromise, setup } from 'xstate'
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
	reuse: fromPromise(({ input }: { input: Input }) => input.reuse()),
	fetch: fromPromise(({ input }: { input: Input }) => input.fetch()),
	store: fromPromise(({ input }: { input: Context }) => input.port.store(response(input))),
	discard: fromPromise(async ({ input }: { input: Context }) => response(input).body?.cancel())
}
const shellAssetModel = setup<
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
>({ actors }).extend({
	guards: {
		responsePresent: (_, params: { response: Response | undefined }) => !!params.response,
		validResponse: ({ context }, params: { response: Response | undefined }) =>
			!!params.response && context.port.valid(params.response)
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
				src: 'reuse',
				input: ({ context }) => context.port,
				onDone: [
					{
						guard: { type: 'validResponse', params: ({ event }) => ({ response: event.output }) },
						target: 'storing',
						actions: assign({ response: ({ event }) => event.output })
					},
					{
						guard: {
							type: 'responsePresent',
							params: ({ event }) => ({ response: event.output })
						},
						target: 'discarding',
						actions: assign({ response: ({ event }) => event.output })
					},
					{ target: 'fetching' }
				],
				onError: 'failed'
			}
		},
		fetching: {
			invoke: {
				src: 'fetch',
				input: ({ context }) => context.port,
				onDone: [
					{
						guard: { type: 'validResponse', params: ({ event }) => ({ response: event.output }) },
						target: 'storing',
						actions: assign({ response: ({ event }) => event.output })
					},
					{ target: 'discarding', actions: assign({ response: ({ event }) => event.output }) }
				],
				onError: 'failed'
			}
		},
		discarding: {
			invoke: {
				src: 'discard',
				input: ({ context }) => context,
				onDone: 'failed',
				onError: 'failed'
			}
		},
		storing: {
			invoke: {
				src: 'store',
				input: ({ context }) => context,
				onDone: 'ready',
				onError: 'failed'
			}
		},
		ready: { type: 'final', entry: assign({ response: undefined, result: 'ready' }) },
		failed: { type: 'final', entry: assign({ response: undefined }) }
	}
})

type ReadInput = { cached: () => Promise<Response | undefined>; fetch: () => Promise<Response> }
type ReadContext = { port: ReadInput; response: Response | undefined; error: unknown }
const readActors = {
	cached: fromPromise(({ input }: { input: ReadInput }) => input.cached()),
	fetch: fromPromise(({ input }: { input: ReadInput }) => input.fetch())
}
/** Runtime cache misses use network without writing runtime responses into the shell cache. */
const shellReadModel = setup<
	ReadContext,
	{ type: 'UNUSED' },
	typeof readActors,
	{},
	{},
	{},
	never,
	string,
	ReadInput,
	{ response: Response | undefined; error: unknown }
>({ actors: readActors }).extend({
	guards: {
		responsePresent: (_, params: { response: Response | undefined }) => !!params.response
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
				src: 'cached',
				input: ({ context }) => context.port,
				onDone: [
					{
						guard: {
							type: 'responsePresent',
							params: ({ event }) => ({ response: event.output })
						},
						target: 'done',
						actions: assign({ response: ({ event }) => event.output })
					},
					{ target: 'fetching' }
				],
				onError: { target: 'done', actions: assign({ error: ({ event }) => event.error }) }
			}
		},
		fetching: {
			invoke: {
				src: 'fetch',
				input: ({ context }) => context.port,
				onDone: { target: 'done', actions: assign({ response: ({ event }) => event.output }) },
				onError: { target: 'done', actions: assign({ error: ({ event }) => event.error }) }
			}
		},
		done: { type: 'final' }
	}
})
