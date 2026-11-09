import { and, not } from 'xstate'
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
			insertArticle: ({ context }) => io.insertArticle(context.resource, required(context.facts)),
			insertDocument: ({ context }) => io.insertDocument(context.resource, required(context.facts)),
			insertTagArticle: ({ context }) =>
				io.insertTagArticle(context.resource, required(context.facts)),
			insertTagDocument: ({ context }) =>
				io.insertTagDocument(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'organization-domain',
		context: domainContext<OrganizationDraft, OrganizationFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: [
						{
							guard: { type: 'parentAvailable', params: ({ event }) => ({ facts: event.output }) },
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
						{
							guard: and(['tagAssignment', 'hasArticleParent']),
							target: 'done',
							actions: 'insertTagArticle'
						},
						{
							guard: and(['tagAssignment', 'hasDocumentParent']),
							target: 'done',
							actions: 'insertTagDocument'
						},
						{
							guard: and([not('tagAssignment'), 'hasArticleParent']),
							target: 'done',
							actions: 'insertArticle'
						},
						{
							guard: and([not('tagAssignment'), 'hasDocumentParent']),
							target: 'done',
							actions: 'insertDocument'
						},
						{ target: 'invalidParent' }
					]
				}
			},
			invalidParent: { entry: 'failParent' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
