import { createArticleTargetLookup } from '../../capture/causal.js'
import { projectTags } from '../../capture/tags.js'
import type { TagOperation } from '../../capture/tags.js'
import { projectOrganization } from '../../capture/organization.js'
import type { OrganizationOperation } from '../../capture/organization.js'
import { assign, enqueueActions, fromCallback, sendTo, setup, raise, and, stateIn } from 'xstate'
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
const subscription = fromCallback(() => {})
type OutputEvent = { type: 'ROWS'; rows: LibraryArticle[] } | { type: 'ERROR' }
const output = fromCallback<OutputEvent, Input>(({ input, receive }) => {
	receive((event) => {
		if (event.type === 'ROWS') input.next(event.rows)
		else input.error()
	})
})
const model = setup<
	{
		articles: Article[]
		documents: DocumentHeader[]
		organization: OrganizationOperation[]
		tags: TagOperation[]
		callbacks: Input | undefined
	},
	Event,
	{
		organization: typeof subscription
		tags: typeof subscription
		articles: typeof subscription
		documents: typeof subscription
		output: typeof output
	},
	{},
	{ publish: undefined; clear: undefined; reportError: undefined },
	{ current: undefined; initialized: undefined },
	never,
	string,
	Input
>({
	actors: {
		tags: subscription,
		organization: subscription,
		articles: subscription,
		documents: subscription,
		output
	},
	guards: {
		current: () => false,
		initialized: and([
			stateIn({ observing: { articles: 'ready' } }),
			stateIn({ observing: { documents: 'ready' } }),
			stateIn({ observing: { tags: 'ready' } }),
			stateIn({ observing: { organization: 'ready' } })
		])
	},
	actions: {
		reportError: enqueueActions(({ check, enqueue }) => {
			if (check('current')) enqueue.sendTo('output', { type: 'ERROR' })
		}),
		publish: sendTo('output', ({ context }) => {
			const targets = createArticleTargetLookup(context.articles)
			const rows = projectLibraryArticles(context.articles, context.documents)
			const organized = projectOrganization(rows, context.organization, context.articles, targets)
			return { type: 'ROWS', rows: projectTags(organized, context.tags, context.articles, targets) }
		}),
		clear: assign({ articles: [], documents: [], organization: [], tags: [], callbacks: undefined })
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
		input: ({ context }) => {
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
						pending: { on: { ARTICLES: { guard: 'current', target: 'ready' } } },
						ready: {}
					}
				},
				documents: {
					initial: 'pending',
					states: {
						pending: { on: { DOCUMENTS: { guard: 'current', target: 'ready' } } },
						ready: {}
					}
				},
				tags: {
					initial: 'pending',
					states: { pending: { on: { TAGS: { guard: 'current', target: 'ready' } } }, ready: {} }
				},
				organization: {
					initial: 'pending',
					states: {
						pending: { on: { ORGANIZATION: { guard: 'current', target: 'ready' } } },
						ready: {}
					}
				},
				data: {
					on: {
						TAGS: {
							guard: 'current',
							actions: [assign({ tags: ({ event }) => event.rows }), raise({ type: 'UPDATED' })]
						},
						ORGANIZATION: {
							guard: 'current',
							actions: [
								assign({ organization: ({ event }) => event.rows }),
								raise({ type: 'UPDATED' })
							]
						},
						ARTICLES: {
							guard: 'current',
							actions: [assign({ articles: ({ event }) => event.rows }), raise({ type: 'UPDATED' })]
						},
						DOCUMENTS: {
							guard: 'current',
							actions: [
								assign({ documents: ({ event }) => event.rows }),
								raise({ type: 'UPDATED' })
							]
						}
					}
				},
				publication: {
					initial: 'idle',
					states: {
						idle: { on: { UPDATED: { guard: 'initialized', target: 'coalescing' } } },
						coalescing: {
							after: {
								0: [{ guard: 'current', target: 'idle', actions: 'publish' }, { target: 'idle' }]
							}
						}
					}
				}
			},
			invoke: [
				{ src: 'articles', onError: 'failed' },
				{ src: 'tags', onError: 'failed' },
				{ src: 'organization', onError: 'failed' },
				{ src: 'documents', onError: 'failed' }
			],
			on: {
				ERROR: 'failed',
				STOP: 'closed'
			}
		},
		failed: {
			type: 'final',
			entry: ['reportError', 'clear']
		},
		closed: { type: 'final', entry: 'clear' }
	}
})

export function createArticleCollectionMachine(cap: Capability) {
	const articles = fromCallback(({ sendBack }) =>
		cap.articles(
			(rows) => sendBack({ type: 'ARTICLES', rows }),
			() => sendBack({ type: 'ERROR' })
		)
	)
	const documents = fromCallback(({ sendBack }) =>
		cap.documents(
			(rows) => sendBack({ type: 'DOCUMENTS', rows }),
			() => sendBack({ type: 'ERROR' })
		)
	)
	return model.provide({
		actors: {
			tags: fromCallback(({ sendBack }) =>
				(cap.tags ?? emptySubscription<TagOperation>)(
					(rows) => sendBack({ type: 'TAGS', rows }),
					() => sendBack({ type: 'ERROR' })
				)
			),
			articles,
			documents,
			organization: fromCallback(({ sendBack }) =>
				(cap.organization ?? emptySubscription<OrganizationOperation>)(
					(rows) => sendBack({ type: 'ORGANIZATION', rows }),
					() => sendBack({ type: 'ERROR' })
				)
			)
		},
		guards: { current: () => cap.isCurrent() }
	})
}
