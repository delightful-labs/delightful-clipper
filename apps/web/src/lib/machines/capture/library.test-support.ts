import { assign, fromPromise, setup } from 'xstate'
import type { LibraryCapability, SaveSpawner } from '../../contracts/library.js'
import type { Candidate } from '../../capture/source.js'
import type { SaveArticleRequest, ArticleSaveResult } from '../../contracts/articles.js'
/** Controlled child still obeys SHUTDOWN → drain → done, rather than an abortable promise. */
export function controlledSave(
	work: (request: SaveArticleRequest) => Promise<ArticleSaveResult>,
	shutdown: () => void = () => {}
) {
	const actors = { work: fromPromise(({ input }: { input: SaveArticleRequest }) => work(input)) }
	return setup<
		{ request: SaveArticleRequest; result: ArticleSaveResult | undefined },
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		SaveArticleRequest,
		ArticleSaveResult
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
	const save = controlledSave(async () => ({
		kind: 'saved',
		operationId: candidate.id,
		receipts: []
	}))
	return {
		libraryId: candidate.id,
		isCurrent: () => true,
		spawnSave: (spawn: SaveSpawner, request: SaveArticleRequest) => spawn(save, { input: request }),
		read: {
			isCurrent: () => true,
			document: async () => null,
			snapshot: async () => null,
			asset: async () => null,
			source: async () => null
		},
		subscribe: () => () => {},
		worker: (report) => ({
			send: (event) => {
				if (event.type === 'STOP') report({ type: 'BACKGROUND_CLOSED' })
			},
			stop: async () => {
				report({ type: 'BACKGROUND_CLOSED' })
			}
		}),
		...overrides
	}
}
