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
			insertArticle: ({ context }) => io.insertArticle(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'article-ensure-domain',
		context: domainContext<ArticleDraft, ArticleEnsureFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: [
						{
							guard: { type: 'articleMissing', params: ({ event }) => ({ facts: event.output }) },
							target: 'ready',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{ target: 'blocked' }
					]
				}
			},
			ready: { entry: 'allow', on: { STAGE: { target: 'done', actions: 'insertArticle' } } },
			blocked: { entry: 'block' },
			done: { type: 'final' }
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
			attachContent: ({ context }) => io.attachContent(context.resource, required(context.facts)),
			createArticle: ({ context }) => io.createArticle(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'article-attachment-domain',
		context: domainContext<ArticleDraft, ArticleAttachmentFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: [
						{
							guard: { type: 'canAttachContent', params: ({ event }) => ({ facts: event.output }) },
							target: 'ready',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{ target: 'blocked' }
					]
				}
			},
			ready: {
				entry: 'allow',
				on: {
					STAGE: [
						{ guard: 'articleExists', target: 'done', actions: 'attachContent' },
						{ target: 'done', actions: 'createArticle' }
					]
				}
			},
			blocked: { entry: 'block' },
			done: { type: 'final' }
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
			recordFailure: ({ context }) => io.recordFailure(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'article-failure-domain',
		context: domainContext<ArticleFailure, ArticleFailureFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: [
						{
							guard: { type: 'articlePending', params: ({ event }) => ({ facts: event.output }) },
							target: 'ready',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{ target: 'blocked' }
					]
				}
			},
			ready: { entry: 'allow', on: { STAGE: { target: 'done', actions: 'recordFailure' } } },
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
