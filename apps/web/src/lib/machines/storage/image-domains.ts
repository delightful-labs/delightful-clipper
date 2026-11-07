import type { ReadyImageWrite, FailedImageWrite, ArticleImage } from '../../images/schema.js'
import { canWriteImage } from '../../images/schema.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { required } from './domain-transaction.js'
import { transactionDomainModel, domainContext } from './domain-model.js'
import type { DomainRead, DomainReceipt } from './domain-model.js'
export type ImagePublicationFacts = {
	draft: ReadyImageWrite
	image: ArticleImage | null
	intent: unknown
	hash: string
}
export type ImageFailureFacts = { draft: FailedImageWrite; image: ArticleImage | null }
type Mutation<Facts> = (resource: TransactionResource, facts: Facts) => void

export function createImagePublicationDomain(io: {
	read: DomainRead<ReadyImageWrite, ImagePublicationFacts>
	insertIntent: Mutation<ImagePublicationFacts>
	insertAsset: Mutation<ImagePublicationFacts>
	publishImage: Mutation<ImagePublicationFacts>
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Image publication unavailable').extend({
		guards: {
			canPublishImage: ({ context }) => {
				const facts = required(context.facts)
				return canWriteImage(facts.image, facts.draft, facts.intent)
			}
		},
		actions: {
			insertIntent: ({ context }) => io.insertIntent(context.resource, required(context.facts)),
			insertAsset: ({ context }) => io.insertAsset(context.resource, required(context.facts)),
			publishImage: ({ context }) => io.publishImage(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'image-publication-domain',
		context: domainContext<ReadyImageWrite, ImagePublicationFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingImage',
						actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
					}
				}
			},
			checkingImage: {
				always: [{ guard: 'canPublishImage', target: 'ready' }, { target: 'blocked' }]
			},
			ready: { entry: 'allow', on: { STAGE: 'insertingIntent' } },
			insertingIntent: { entry: 'insertIntent', always: 'insertingAsset' },
			insertingAsset: { entry: 'insertAsset', always: 'publishingImage' },
			publishingImage: { entry: 'publishImage', always: 'done' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
export function createImageFailureDomain(io: {
	read: DomainRead<FailedImageWrite, ImageFailureFacts>
	recordFailure: Mutation<ImageFailureFacts>
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Image publication unavailable').extend({
		guards: {
			canRecordFailure: ({ context }) => {
				const facts = required(context.facts)
				return canWriteImage(facts.image, facts.draft, undefined)
			}
		},
		actions: {
			recordFailure: ({ context }) => io.recordFailure(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'image-failure-domain',
		context: domainContext<FailedImageWrite, ImageFailureFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingImage',
						actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
					}
				}
			},
			checkingImage: {
				always: [{ guard: 'canRecordFailure', target: 'ready' }, { target: 'blocked' }]
			},
			ready: { entry: 'allow', on: { STAGE: 'recordingFailure' } },
			recordingFailure: { entry: 'recordFailure', always: 'done' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
