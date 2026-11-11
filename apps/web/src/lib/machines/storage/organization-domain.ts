import { types } from 'xstate'
import type { OrganizationDraft } from './organize.js'
import { canOrganizeArticle } from '../../capture/organization.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { transactionDomainModel, domainContext } from './domain-model.js'
import type { DomainRead, DomainReceipt } from './domain-model.js'
export type OrganizationFacts = {
	draft: OrganizationDraft
	operationId: string
	article: unknown
	document: unknown
	parents: string[]
}
type Mutation = (resource: TransactionResource, facts: OrganizationFacts) => void

export function createOrganizationDomain(io: {
	read: DomainRead<OrganizationDraft, OrganizationFacts>
	insertArticle: Mutation
	insertDocument: Mutation
	insertTagArticle: Mutation
	insertTagDocument: Mutation
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Article unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: OrganizationFacts }>() } },
			invalidParent: { schemas: { context: types<{ facts: OrganizationFacts }>() } },
			blocked: {},
			done: {},
			insertTagArticle: { schemas: { context: types<{ facts: OrganizationFacts }>() } },
			insertTagDocument: { schemas: { context: types<{ facts: OrganizationFacts }>() } },
			insertArticle: { schemas: { context: types<{ facts: OrganizationFacts }>() } },
			insertDocument: { schemas: { context: types<{ facts: OrganizationFacts }>() } }
		},
		guards: {
			parentAvailable: (_, { facts }: { facts: OrganizationFacts }) =>
				canOrganizeArticle(facts.article, facts.document),
			tagAssignment: (_, { facts }: { facts: OrganizationFacts }) => facts.draft.field === 'tag',
			hasArticleParent: (_, { facts }: { facts: OrganizationFacts }) => facts.article != null,
			hasDocumentParent: (_, { facts }: { facts: OrganizationFacts }) => facts.document != null
		},
		actions: {
			failParent: () => {
				throw new Error('Missing organization parent')
			},
			insertArticle: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
				},
				{ facts }: { facts: OrganizationFacts }
			) => io.insertArticle(context.resource, facts),
			insertDocument: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
				},
				{ facts }: { facts: OrganizationFacts }
			) => io.insertDocument(context.resource, facts),
			insertTagArticle: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
				},
				{ facts }: { facts: OrganizationFacts }
			) => io.insertTagArticle(context.resource, facts),
			insertTagDocument: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
				},
				{ facts }: { facts: OrganizationFacts }
			) => io.insertTagDocument(context.resource, facts)
		}
	})
	return model.createMachine({
		id: 'organization-domain',
		context: domainContext<OrganizationDraft, OrganizationFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.parentAvailable(args, { facts: args.event.output })) {
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
						if (
							args.guards.tagAssignment(args, { facts: args.context.facts }) &&
							args.guards.hasArticleParent(args, { facts: args.context.facts })
						) {
							return { target: 'insertTagArticle' }
						}
						if (
							args.guards.tagAssignment(args, { facts: args.context.facts }) &&
							args.guards.hasDocumentParent(args, { facts: args.context.facts })
						) {
							return { target: 'insertTagDocument' }
						}
						if (
							!args.guards.tagAssignment(args, { facts: args.context.facts }) &&
							args.guards.hasArticleParent(args, { facts: args.context.facts })
						) {
							return { target: 'insertArticle' }
						}
						if (
							!args.guards.tagAssignment(args, { facts: args.context.facts }) &&
							args.guards.hasDocumentParent(args, { facts: args.context.facts })
						) {
							return { target: 'insertDocument' }
						}
						return { target: 'invalidParent' }
					}
				}
			},
			invalidParent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.failParent()
					})
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
			insertTagArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertTagArticle(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertTagDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertTagDocument(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertArticle(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertDocument(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
