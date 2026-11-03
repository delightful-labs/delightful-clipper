import { assign, fromPromise, setup } from 'xstate'
import type { LibraryCapability, SaveSpawner } from '../../contracts/library.js'
import type { Candidate } from '../../capture/source.js'
import type { SaveRequest, SaveResult } from '../../contracts/storage.js'
/** Controlled child still obeys SHUTDOWN → drain → done, rather than an abortable promise. */
export function controlledSave(
	work: (request: SaveRequest) => Promise<SaveResult>,
	shutdown: () => void = () => {}
) {
	const actors = { work: fromPromise(({ input }: { input: SaveRequest }) => work(input)) }
	return setup<
		{ request: SaveRequest; result: SaveResult | undefined },
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		SaveRequest,
		SaveResult
	>({ actors }).createMachine({
		initial: 'running',
		context: ({ input }) => ({ request: input, result: undefined }),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing result')
			return context.result
		},
		states: {
			running: {
				initial: 'active',
				states: {
					active: { on: { SHUTDOWN: { target: 'stopping', actions: shutdown } } },
					stopping: {}
				},
				invoke: {
					src: 'work',
					input: ({ context }) => context.request,
					onDone: { target: 'done', actions: assign({ result: ({ event }) => event.output }) }
				}
			},
			done: { type: 'final' }
		}
	})
}
export function testLibraryCapability(
	candidate: Candidate,
	overrides: Partial<LibraryCapability> = {}
): LibraryCapability {
	const save = controlledSave(async (request) => ({
		kind: 'saved',
		operationId: request.operationId,
		receipts: []
	}))
	return {
		isCurrent: () => true,
		resolve: async () => candidate.finalUrl,
		identify: async () => candidate.id,
		hasDocument: async () => false,
		hasIntent: async () => false,
		extract: async () => candidate,
		spawnSave: (spawn: SaveSpawner, request: SaveRequest) => spawn(save, { input: request }),
		read: {
			isCurrent: () => true,
			document: async () => null,
			snapshot: async () => null,
			asset: async () => null,
			source: async () => null
		},
		subscribe: () => () => {},
		...overrides
	}
}
