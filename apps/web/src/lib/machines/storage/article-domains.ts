import type { Article, ArticleDraft } from '../../contracts/articles.js'
import { canAttachArticleContent, isPendingArticle } from '../../capture/article-policy.js'
import { hasExistingArticle } from '../../capture/content-policy.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { types } from 'xstate'
import { transactionDomainModel, domainContext } from './domain-model.js'
import type { DomainRead, DomainReceipt } from './domain-model.js'
export type ArticleEnsureFacts = { draft: ArticleDraft; article: Article | null }
export type ArticleAttachmentFacts = ArticleEnsureFacts & { available: boolean }
export type ArticleFailure = { id: string; code: string | null }
export type ArticleFailureFacts = { draft: ArticleFailure; article: Article | null }
type Mutation<Facts> = (resource: TransactionResource, facts: Facts) => void

export function createArticleEnsureDomain(io: {
	read: DomainRead<ArticleDraft, ArticleEnsureFacts>
	insertArticle: Mutation<ArticleEnsureFacts>
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Article already exists or is unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ArticleEnsureFacts }>() } },
			blocked: {},
			done: {},
			insertArticle: { schemas: { context: types<{ facts: ArticleEnsureFacts }>() } }
		},
		guards: {
			articleMissing: (_, { facts }: { facts: ArticleEnsureFacts }) => !hasExistingArticle(facts)
		},
		actions: {
			insertArticle: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<ArticleDraft, ArticleEnsureFacts>
				},
				{ facts }: { facts: ArticleEnsureFacts }
			) => io.insertArticle(context.resource, facts)
		}
	})
	return model.createMachine({
		id: 'article-ensure-domain',
		context: domainContext<ArticleDraft, ArticleEnsureFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<ArticleDraft, ArticleEnsureFacts>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.articleMissing(args, { facts: args.event.output })) {
							return { target: 'ready', context: { facts: args.event.output } }
						}
						return { target: 'blocked' }
					}
				}
			},
			ready: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: { target: 'insertArticle' }
				}
			},
			blocked: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.block(args)
					})
				}
			},
			done: { type: 'final' },
			insertArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertArticle(args, { facts: args.context.facts })
						args.self.send({ type: 'STAGED' })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
export function createArticleAttachmentDomain(io: {
	read: DomainRead<ArticleDraft, ArticleAttachmentFacts>
	attachContent: Mutation<ArticleAttachmentFacts>
	createArticle: Mutation<ArticleAttachmentFacts>
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Article already exists or is unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ArticleAttachmentFacts }>() } },
			blocked: {},
			done: {},
			attachContent: { schemas: { context: types<{ facts: ArticleAttachmentFacts }>() } },
			createArticle: { schemas: { context: types<{ facts: ArticleAttachmentFacts }>() } }
		},
		guards: {
			canAttachContent: (_, { facts }: { facts: ArticleAttachmentFacts }) =>
				canAttachArticleContent(facts.article, facts.available),
			articleExists: (_, { facts }: { facts: ArticleAttachmentFacts }) => hasExistingArticle(facts)
		},
		actions: {
			attachContent: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<ArticleDraft, ArticleAttachmentFacts>
				},
				{ facts }: { facts: ArticleAttachmentFacts }
			) => io.attachContent(context.resource, facts),
			createArticle: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<ArticleDraft, ArticleAttachmentFacts>
				},
				{ facts }: { facts: ArticleAttachmentFacts }
			) => io.createArticle(context.resource, facts)
		}
	})
	return model.createMachine({
		id: 'article-attachment-domain',
		context: domainContext<ArticleDraft, ArticleAttachmentFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<ArticleDraft, ArticleAttachmentFacts>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.canAttachContent(args, { facts: args.event.output })) {
							return { target: 'ready', context: { facts: args.event.output } }
						}
						return { target: 'blocked' }
					}
				}
			},
			ready: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: (args) => {
						if (args.guards.articleExists(args, { facts: args.context.facts })) {
							return { target: 'attachContent' }
						}
						return { target: 'createArticle' }
					}
				}
			},
			blocked: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.block(args)
					})
				}
			},
			done: { type: 'final' },
			attachContent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.attachContent(args, { facts: args.context.facts })
						args.self.send({ type: 'STAGED' })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			createArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.createArticle(args, { facts: args.context.facts })
						args.self.send({ type: 'STAGED' })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
export function createArticleFailureDomain(io: {
	read: DomainRead<ArticleFailure, ArticleFailureFacts>
	recordFailure: Mutation<ArticleFailureFacts>
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Article is complete or unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ArticleFailureFacts }>() } },
			blocked: {},
			done: {},
			recordFailure: { schemas: { context: types<{ facts: ArticleFailureFacts }>() } }
		},
		guards: {
			articlePending: (_, { facts }: { facts: ArticleFailureFacts }) =>
				isPendingArticle(facts.article)
		},
		actions: {
			recordFailure: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<ArticleFailure, ArticleFailureFacts>
				},
				{ facts }: { facts: ArticleFailureFacts }
			) => io.recordFailure(context.resource, facts)
		}
	})
	return model.createMachine({
		id: 'article-failure-domain',
		context: domainContext<ArticleFailure, ArticleFailureFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<ArticleFailure, ArticleFailureFacts>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.articlePending(args, { facts: args.event.output })) {
							return { target: 'ready', context: { facts: args.event.output } }
						}
						return { target: 'blocked' }
					}
				}
			},
			ready: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: { target: 'recordFailure' }
				}
			},
			blocked: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.block(args)
					})
				}
			},
			done: { type: 'final' },
			recordFailure: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.recordFailure(args, { facts: args.context.facts })
						args.self.send({ type: 'STAGED' })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
