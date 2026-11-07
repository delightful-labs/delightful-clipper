import { and } from 'xstate'
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
			canBindIntent: (_, params: { facts: ContentFacts }) => canBindStorageIntent(params.facts),
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
					onDone: [
						{
							guard: { type: 'canBindIntent', params: ({ event }) => ({ facts: event.output }) },
							target: 'ready',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{
							target: 'blocked',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						}
					]
				}
			},
			ready: {
				entry: 'allow',
				on: {
					STAGE: [
						{
							guard: and(['articleLinked', 'articleExists']),
							target: 'done',
							actions: ['insertIntent', 'bindArticle']
						},
						{ guard: 'articleLinked', target: 'done', actions: ['insertIntent', 'createArticle'] },
						{ target: 'done', actions: 'insertIntent' }
					]
				}
			},
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
			canPublishContent: (_, params: { facts: ContentFacts }) =>
				canPublishStoredContent(params.facts),
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
					onDone: [
						{
							guard: {
								type: 'canPublishContent',
								params: ({ event }) => ({ facts: event.output })
							},
							target: 'ready',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{
							target: 'blocked',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						}
					]
				}
			},
			ready: {
				entry: 'allow',
				on: {
					STAGE: [
						{
							guard: and(['articleLinked', 'hasSource']),
							target: 'done',
							actions: ['publishContent', 'attachContent', 'publishSource']
						},
						{
							guard: 'articleLinked',
							target: 'done',
							actions: ['publishContent', 'attachContent']
						},
						{ guard: 'hasSource', target: 'done', actions: ['publishContent', 'publishSource'] },
						{ target: 'done', actions: 'publishContent' }
					]
				}
			},
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
