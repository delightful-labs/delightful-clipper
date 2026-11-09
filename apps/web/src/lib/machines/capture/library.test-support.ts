import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic } from 'xstate'

import type { LibraryCapability, SaveSpawner } from '../../contracts/library.js'
import type { Candidate } from '../../capture/source.js'
import type { SaveArticleRequest, ArticleSaveResult } from '../../contracts/articles.js'
/** Controlled child still obeys SHUTDOWN → drain → done, rather than an abortable promise. */
export function controlledSave(
	work: (request: SaveArticleRequest) => Promise<ArticleSaveResult>,
	shutdown: () => void = () => {}
) {
	const actors = {
		work: createAsyncLogic({ run: ({ input }: { input: SaveArticleRequest }) => work(input) })
	}
	return setup({
		schemas: {
			context: types<{ request: SaveArticleRequest; result: ArticleSaveResult | undefined }>(),
			events: { SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>() },
			input: types<SaveArticleRequest>(),
			output: types<ArticleSaveResult>(),
			tags: types<string>(),
			children: { work: types<import('xstate').ActorRefFrom<(typeof actors)['work']>>() }
		},
		actors
	}).createMachine({
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
					active: {
						on: {
							SHUTDOWN: (_, enq) => {
								enq(shutdown)
								return { target: 'stopping' }
							}
						}
					},
					stopping: {}
				},
				invoke: {
					id: 'work',
					src: 'work',
					input: ({
						context
					}: {
						context: { request: SaveArticleRequest; result: ArticleSaveResult | undefined }
					}) => context.request,
					onDone: (args) => {
						return { target: 'done', context: { result: args.event.output } }
					}
				}
			},
			done: { type: 'final' as const }
		}
	})
}
export function testLibraryCapability(
	candidate: Candidate,
	overrides: Partial<LibraryCapability> = {}
): LibraryCapability {
	const save = controlledSave(async () => ({
		kind: 'saved' as const,
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
				if (event.type === 'STOP') report({ type: 'BACKGROUND_CLOSED' as const })
			},
			stop: async () => {
				report({ type: 'BACKGROUND_CLOSED' as const })
			}
		}),
		...overrides
	}
}
