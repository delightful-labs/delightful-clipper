import type { PreparedSave } from '../../contracts/storage.js'
import {
	canBindStorageIntent,
	canPublishStoredContent,
	hasLinkedArticle,
	hasExistingArticle,
	hasContentSource
} from '../../capture/content-policy.js'
import type { ContentFacts } from '../../capture/content-policy.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { required } from './domain-transaction.js'
import { transactionDomainModel, domainContext } from './domain-model.js'
import type { DomainRead, DomainReceipt } from './domain-model.js'
type Mutation = (resource: TransactionResource, facts: ContentFacts) => void

export function createContentIntentDomain(io: {
	read: DomainRead<PreparedSave, ContentFacts>
	insertIntent: Mutation
	bindArticle: Mutation
	createArticle: Mutation
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Operation identity is not eligible').extend({
		guards: {
			canBindIntent: ({ context }) => canBindStorageIntent(required(context.facts)),
			articleLinked: ({ context }) => hasLinkedArticle(required(context.facts)),
			articleExists: ({ context }) => hasExistingArticle(required(context.facts))
		},
		actions: {
			insertIntent: ({ context }) => io.insertIntent(context.resource, required(context.facts)),
			bindArticle: ({ context }) => io.bindArticle(context.resource, required(context.facts)),
			createArticle: ({ context }) => io.createArticle(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'content-intent-domain',
		context: domainContext<PreparedSave, ContentFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingIntent',
						actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
					}
				}
			},
			checkingIntent: {
				always: [{ guard: 'canBindIntent', target: 'ready' }, { target: 'blocked' }]
			},
			ready: { entry: 'allow', on: { STAGE: 'insertingIntent' } },
			insertingIntent: { entry: 'insertIntent', always: 'routingArticle' },
			routingArticle: {
				always: [{ guard: 'articleLinked', target: 'selectingArticle' }, { target: 'done' }]
			},
			selectingArticle: {
				always: [
					{ guard: 'articleExists', target: 'bindingArticle' },
					{ target: 'creatingArticle' }
				]
			},
			bindingArticle: { entry: 'bindArticle', always: 'done' },
			creatingArticle: { entry: 'createArticle', always: 'done' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
export function createContentPublicationDomain(io: {
	read: DomainRead<PreparedSave, ContentFacts>
	publishContent: Mutation
	attachContent: Mutation
	publishSource: Mutation
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Operation identity is not eligible').extend({
		guards: {
			canPublishContent: ({ context }) => canPublishStoredContent(required(context.facts)),
			articleLinked: ({ context }) => hasLinkedArticle(required(context.facts)),
			hasSource: ({ context }) => hasContentSource(required(context.facts))
		},
		actions: {
			publishContent: ({ context }) => io.publishContent(context.resource, required(context.facts)),
			attachContent: ({ context }) => io.attachContent(context.resource, required(context.facts)),
			publishSource: ({ context }) => io.publishSource(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'content-publication-domain',
		context: domainContext<PreparedSave, ContentFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingPublication',
						actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
					}
				}
			},
			checkingPublication: {
				always: [{ guard: 'canPublishContent', target: 'ready' }, { target: 'blocked' }]
			},
			ready: { entry: 'allow', on: { STAGE: 'publishingContent' } },
			publishingContent: { entry: 'publishContent', always: 'routingArticle' },
			routingArticle: {
				always: [
					{ guard: 'articleLinked', target: 'attachingContent' },
					{ target: 'routingSource' }
				]
			},
			attachingContent: { entry: 'attachContent', always: 'routingSource' },
			routingSource: {
				always: [{ guard: 'hasSource', target: 'publishingSource' }, { target: 'done' }]
			},
			publishingSource: { entry: 'publishSource', always: 'done' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
