import type { EventPayload } from '../events.js'
import { types, createCallbackLogic, setup, matchesState } from 'xstate'
import { createArticleTargetLookup } from '../../capture/causal.js'
import { projectTags } from '../../capture/tags.js'
import type { TagOperation } from '../../capture/tags.js'
import { projectOrganization } from '../../capture/organization.js'
import type { OrganizationOperation } from '../../capture/organization.js'

import type { Article, LibraryArticle } from '../../contracts/articles.js'
import type { DocumentHeader } from '../../contracts/storage.js'
import { projectLibraryArticles } from '../../capture/library-articles.js'
type Subscribe<T> = (next: (rows: T[]) => void, error: () => void) => () => void
function emptySubscription<T>(next: (rows: T[]) => void, _error: () => void) {
	next([])
	return () => {}
}
type Capability = {
	isCurrent: () => boolean
	articles: Subscribe<Article>
	documents: Subscribe<DocumentHeader>
	organization?: Subscribe<OrganizationOperation>
	tags?: Subscribe<TagOperation>
}
type Input = { next: (rows: LibraryArticle[]) => void; error: () => void }
type Event =
	| { type: 'ORGANIZATION'; rows: OrganizationOperation[] }
	| { type: 'TAGS'; rows: TagOperation[] }
	| { type: 'ARTICLES'; rows: Article[] }
	| { type: 'DOCUMENTS'; rows: DocumentHeader[] }
	| { type: 'ERROR' | 'STOP' | 'UPDATED' }
const subscription = createCallbackLogic(() => {})
type OutputEvent = { type: 'ROWS'; rows: LibraryArticle[] } | { type: 'ERROR' }
const output = createCallbackLogic<OutputEvent, Input>(({ input, receive }) => {
	receive((event) => {
		if (event.type === 'ROWS') input.next(event.rows)
		else input.error()
	})
})
const model = setup({
	schemas: {
		context: types<{
			articles: Article[]
			documents: DocumentHeader[]
			organization: OrganizationOperation[]
			tags: TagOperation[]
			callbacks: Input | undefined
		}>(),
		events: {
			ORGANIZATION: types<EventPayload<Event, 'ORGANIZATION'>>(),
			TAGS: types<EventPayload<Event, 'TAGS'>>(),
			ARTICLES: types<EventPayload<Event, 'ARTICLES'>>(),
			DOCUMENTS: types<EventPayload<Event, 'DOCUMENTS'>>(),
			ERROR: types<EventPayload<Event, 'ERROR'>>(),
			STOP: types<EventPayload<Event, 'STOP'>>(),
			UPDATED: types<EventPayload<Event, 'UPDATED'>>()
		},
		input: types<Input>(),
		tags: types<string>(),
		children: {
			tags: types<import('xstate').ActorRefFrom<typeof subscription>>(),
			organization: types<import('xstate').ActorRefFrom<typeof subscription>>(),
			articles: types<import('xstate').ActorRefFrom<typeof subscription>>(),
			documents: types<import('xstate').ActorRefFrom<typeof subscription>>(),
			output: types<import('xstate').ActorRefFrom<typeof output>>()
		}
	},
	actors: {
		tags: subscription,
		organization: subscription,
		articles: subscription,
		documents: subscription,
		output
	},
	guards: {
		current: (): boolean => false
	},
	actions: {
		clear: () => ({
			context: { articles: [], documents: [], organization: [], tags: [], callbacks: undefined }
		})
	}
}).createMachine({
	id: 'article-collection',
	context: ({ input }) => ({
		articles: [],
		documents: [],
		organization: [],
		tags: [],
		callbacks: input
	}),
	initial: 'observing',
	invoke: {
		id: 'output',
		src: 'output',
		input: ({
			context
		}: {
			context: {
				articles: Article[]
				documents: DocumentHeader[]
				organization: OrganizationOperation[]
				tags: TagOperation[]
				callbacks: Input | undefined
			}
		}) => {
			if (!context.callbacks) throw new Error('Missing collection callbacks')
			return context.callbacks
		}
	},
	states: {
		observing: {
			type: 'parallel',
			states: {
				articles: {
					initial: 'pending',
					states: {
						pending: {
							on: {
								ARTICLES: (args) => {
									if (!args.guards.current()) return
									return { target: 'ready' }
								}
							}
						},
						ready: {}
					}
				},
				documents: {
					initial: 'pending',
					states: {
						pending: {
							on: {
								DOCUMENTS: (args) => {
									if (!args.guards.current()) return
									return { target: 'ready' }
								}
							}
						},
						ready: {}
					}
				},
				tags: {
					initial: 'pending',
					states: {
						pending: {
							on: {
								TAGS: (args) => {
									if (!args.guards.current()) return
									return { target: 'ready' }
								}
							}
						},
						ready: {}
					}
				},
				organization: {
					initial: 'pending',
					states: {
						pending: {
							on: {
								ORGANIZATION: (args) => {
									if (!args.guards.current()) return
									return { target: 'ready' }
								}
							}
						},
						ready: {}
					}
				},
				data: {
					on: {
						TAGS: (args, enq) => {
							if (!args.guards.current()) return
							enq.raise({ type: 'UPDATED' })
							return { context: { tags: args.event.rows } }
						},
						ORGANIZATION: (args, enq) => {
							if (!args.guards.current()) return
							enq.raise({ type: 'UPDATED' })
							return { context: { organization: args.event.rows } }
						},
						ARTICLES: (args, enq) => {
							if (!args.guards.current()) return
							enq.raise({ type: 'UPDATED' })
							return { context: { articles: args.event.rows } }
						},
						DOCUMENTS: (args, enq) => {
							if (!args.guards.current()) return
							enq.raise({ type: 'UPDATED' })
							return { context: { documents: args.event.rows } }
						}
					}
				},
				publication: {
					initial: 'idle',
					states: {
						idle: {
							on: {
								UPDATED: (args) => {
									if (
										!(
											matchesState({ observing: { articles: 'ready' } }, args.value) &&
											matchesState({ observing: { documents: 'ready' } }, args.value) &&
											matchesState({ observing: { tags: 'ready' } }, args.value) &&
											matchesState({ observing: { organization: 'ready' } }, args.value)
										)
									)
										return
									return { target: 'coalescing' }
								}
							}
						},
						coalescing: {
							after: {
								0: (args, enq) => {
									if (args.guards.current()) {
										enq.sendTo(
											'output',
											(({ context }): OutputEvent => {
												const targets = createArticleTargetLookup(context.articles)
												const rows = projectLibraryArticles(context.articles, context.documents)
												const organized = projectOrganization(
													rows,
													context.organization,
													context.articles,
													targets
												)
												return {
													type: 'ROWS',
													rows: projectTags(organized, context.tags, context.articles, targets)
												}
											})(args)
										)
										return { target: 'idle' }
									}
									return { target: 'idle' }
								}
							}
						}
					}
				}
			},
			invoke: [
				{ id: 'articles', src: 'articles', onError: { target: 'failed' } },
				{ id: 'tags', src: 'tags', onError: { target: 'failed' } },
				{ id: 'organization', src: 'organization', onError: { target: 'failed' } },
				{ id: 'documents', src: 'documents', onError: { target: 'failed' } }
			],
			on: {
				ERROR: { target: 'failed' },
				STOP: { target: 'closed' }
			}
		},
		failed: {
			type: 'final',
			entry: (args, enq) => {
				if (args.guards.current()) enq.sendTo('output', { type: 'ERROR' })
				return { context: args.actions.clear().context }
			}
		},
		closed: {
			type: 'final',
			entry: (args) => {
				return { context: args.actions.clear().context }
			}
		}
	}
})

export function createArticleCollectionMachine(cap: Capability) {
	const articles = createCallbackLogic(({ sendBack }) =>
		cap.articles(
			(rows) => sendBack({ type: 'ARTICLES', rows }),
			() => sendBack({ type: 'ERROR' })
		)
	)
	const documents = createCallbackLogic(({ sendBack }) =>
		cap.documents(
			(rows) => sendBack({ type: 'DOCUMENTS', rows }),
			() => sendBack({ type: 'ERROR' })
		)
	)
	return model.provide({
		actors: {
			tags: createCallbackLogic(({ sendBack }) =>
				(cap.tags ?? emptySubscription<TagOperation>)(
					(rows) => sendBack({ type: 'TAGS', rows }),
					() => sendBack({ type: 'ERROR' })
				)
			),
			articles,
			documents,
			organization: createCallbackLogic(({ sendBack }) =>
				(cap.organization ?? emptySubscription<OrganizationOperation>)(
					(rows) => sendBack({ type: 'ORGANIZATION', rows }),
					() => sendBack({ type: 'ERROR' })
				)
			)
		},
		guards: { current: () => cap.isCurrent() }
	})
}
