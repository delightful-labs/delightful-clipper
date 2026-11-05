import { projectOrganization } from '../../capture/organization.js'
import type { OrganizationOperation } from '../../capture/organization.js'
import { assign, enqueueActions, fromCallback, sendTo, setup } from 'xstate'
import type { Article, LibraryArticle } from '../../contracts/articles.js'
import type { DocumentHeader } from '../../contracts/storage.js'
import { projectLibraryArticles } from '../../capture/library-articles.js'
type Subscribe<T> = (next: (rows: T[]) => void, error: () => void) => () => void
type Capability = {
	isCurrent: () => boolean
	articles: Subscribe<Article>
	documents: Subscribe<DocumentHeader>
	organization?: Subscribe<OrganizationOperation>
}
type Input = { next: (rows: LibraryArticle[]) => void; error: () => void }
type Event =
	| { type: 'ORGANIZATION'; rows: OrganizationOperation[] }
	| { type: 'ARTICLES'; rows: Article[] }
	| { type: 'DOCUMENTS'; rows: DocumentHeader[] }
	| { type: 'ERROR' | 'STOP' }
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
		callbacks: Input | undefined
	},
	Event,
	{
		organization: typeof subscription
		articles: typeof subscription
		documents: typeof subscription
		output: typeof output
	},
	{},
	{ publish: undefined; clear: undefined; reportError: undefined },
	{ current: undefined },
	never,
	string,
	Input
>({
	actors: { organization: subscription, articles: subscription, documents: subscription, output },
	guards: { current: () => false },
	actions: {
		reportError: enqueueActions(({ check, enqueue }) => {
			if (check('current')) enqueue.sendTo('output', { type: 'ERROR' })
		}),
		publish: sendTo('output', ({ context }) => ({
			type: 'ROWS',
			rows: projectOrganization(
				projectLibraryArticles(context.articles, context.documents),
				context.organization,
				context.articles
			)
		})),
		clear: assign({ articles: [], documents: [], organization: [], callbacks: undefined })
	}
}).createMachine({
	id: 'article-collection',
	context: ({ input }) => ({ articles: [], documents: [], organization: [], callbacks: input }),
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
			invoke: [
				{ src: 'articles', onError: 'failed' },
				{ src: 'organization', onError: 'failed' },
				{ src: 'documents', onError: 'failed' }
			],
			on: {
				ORGANIZATION: {
					guard: 'current',
					actions: [assign({ organization: ({ event }) => event.rows }), 'publish']
				},
				ARTICLES: {
					guard: 'current',
					actions: [assign({ articles: ({ event }) => event.rows }), 'publish']
				},
				DOCUMENTS: {
					guard: 'current',
					actions: [assign({ documents: ({ event }) => event.rows }), 'publish']
				},
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
			articles,
			documents,
			organization: fromCallback(({ sendBack }) =>
				cap.organization?.(
					(rows) => sendBack({ type: 'ORGANIZATION', rows }),
					() => sendBack({ type: 'ERROR' })
				)
			)
		},
		guards: { current: () => cap.isCurrent() }
	})
}
