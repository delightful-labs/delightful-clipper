import type { OrganizationDraft } from './organize.js'
import { canOrganizeArticle } from '../../capture/organization.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { required } from './domain-transaction.js'
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
		guards: {
			parentAvailable: (_, { facts }: { facts: OrganizationFacts }) =>
				canOrganizeArticle(facts.article, facts.document),
			tagAssignment: ({ context }) => required(context.facts).draft.field === 'tag',
			hasArticleParent: ({ context }) => required(context.facts).article != null,
			hasDocumentParent: ({ context }) => required(context.facts).document != null
		},
		actions: {
			failParent: () => {
				throw new Error('Missing organization parent')
			},
			insertArticle: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
			}) => io.insertArticle(context.resource, required(context.facts)),
			insertDocument: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
			}) => io.insertDocument(context.resource, required(context.facts)),
			insertTagArticle: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
			}) => io.insertTagArticle(context.resource, required(context.facts)),
			insertTagDocument: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<OrganizationDraft, OrganizationFacts>
			}) => io.insertTagDocument(context.resource, required(context.facts))
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.parentAvailable(args, (({ event }) => ({ facts: event.output }))(args))
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
						if (args.guards.tagAssignment(args) && args.guards.hasArticleParent(args)) {
							return { target: 'insertTagArticle', context: patch }
						}
						if (args.guards.tagAssignment(args) && args.guards.hasDocumentParent(args)) {
							return { target: 'insertTagDocument', context: patch }
						}
						if (!args.guards.tagAssignment(args) && args.guards.hasArticleParent(args)) {
							return { target: 'insertArticle', context: patch }
						}
						if (!args.guards.tagAssignment(args) && args.guards.hasDocumentParent(args)) {
							return { target: 'insertDocument', context: patch }
						}
						return { target: 'invalidParent', context: patch }
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
			done: { type: 'final' as const },
			insertTagArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertTagArticle(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			insertTagDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertTagDocument(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			insertArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertArticle(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			insertDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertDocument(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
