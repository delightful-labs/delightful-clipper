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
			parentAvailable: ({ context }) => {
				const facts = required(context.facts)
				return canOrganizeArticle(facts.article, facts.document)
			},
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
					onDone: {
						target: 'checkingParent',
						actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
					}
				}
			},
			checkingParent: {
				always: [{ guard: 'parentAvailable', target: 'ready' }, { target: 'blocked' }]
			},
			ready: { entry: 'allow', on: { STAGE: 'selectingKind' } },
			selectingKind: {
				always: [
					{ guard: 'tagAssignment', target: 'selectingTagParent' },
					{ target: 'selectingParent' }
				]
			},
			selectingParent: {
				always: [
					{ guard: 'hasArticleParent', target: 'insertingArticle' },
					{ guard: 'hasDocumentParent', target: 'insertingDocument' },
					{ target: 'invalidParent' }
				]
			},
			selectingTagParent: {
				always: [
					{ guard: 'hasArticleParent', target: 'insertingTagArticle' },
					{ guard: 'hasDocumentParent', target: 'insertingTagDocument' },
					{ target: 'invalidParent' }
				]
			},
			insertingArticle: { entry: 'insertArticle', always: 'done' },
			insertingDocument: { entry: 'insertDocument', always: 'done' },
			insertingTagArticle: { entry: 'insertTagArticle', always: 'done' },
			insertingTagDocument: { entry: 'insertTagDocument', always: 'done' },
			invalidParent: { entry: 'failParent' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
