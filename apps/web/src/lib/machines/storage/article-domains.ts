import type { Article, ArticleDraft } from '../../contracts/articles.js'
import { canAttachArticleContent, isPendingArticle } from '../../capture/article-policy.js'
import { hasExistingArticle } from '../../capture/content-policy.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { required } from './domain-transaction.js'
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
		guards: {
			articleMissing: (_, { facts }: { facts: ArticleEnsureFacts }) => !hasExistingArticle(facts)
		},
		actions: {
			insertArticle: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<ArticleDraft, ArticleEnsureFacts>
			}) => io.insertArticle(context.resource, required(context.facts))
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.articleMissing(args, (({ event }) => ({ facts: event.output }))(args))
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'ready', context: patch }
						}
						return { target: 'blocked', context: patch }
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
					STAGE: (_args, _enq) => {
						let patch = {}
						return { target: 'insertArticle', context: patch }
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
			done: { type: 'final' as const },
			insertArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertArticle(args)
						args.self.send({ type: 'STAGED' as const })
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
		guards: {
			canAttachContent: (_, { facts }: { facts: ArticleAttachmentFacts }) =>
				canAttachArticleContent(facts.article, facts.available),
			articleExists: ({ context }) => hasExistingArticle(required(context.facts))
		},
		actions: {
			attachContent: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<ArticleDraft, ArticleAttachmentFacts>
			}) => io.attachContent(context.resource, required(context.facts)),
			createArticle: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<ArticleDraft, ArticleAttachmentFacts>
			}) => io.createArticle(context.resource, required(context.facts))
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.canAttachContent(args, (({ event }) => ({ facts: event.output }))(args))
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'ready', context: patch }
						}
						return { target: 'blocked', context: patch }
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
					STAGE: (args, _enq) => {
						let patch = {}
						if (args.guards.articleExists(args)) {
							return { target: 'attachContent', context: patch }
						}
						return { target: 'createArticle', context: patch }
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
			done: { type: 'final' as const },
			attachContent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.attachContent(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			createArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.createArticle(args)
						args.self.send({ type: 'STAGED' as const })
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
		guards: {
			articlePending: (_, { facts }: { facts: ArticleFailureFacts }) =>
				isPendingArticle(facts.article)
		},
		actions: {
			recordFailure: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<ArticleFailure, ArticleFailureFacts>
			}) => io.recordFailure(context.resource, required(context.facts))
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.articlePending(args, (({ event }) => ({ facts: event.output }))(args))
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'ready', context: patch }
						}
						return { target: 'blocked', context: patch }
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
					STAGE: (_args, _enq) => {
						let patch = {}
						return { target: 'recordFailure', context: patch }
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
			done: { type: 'final' as const },
			recordFailure: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.recordFailure(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
