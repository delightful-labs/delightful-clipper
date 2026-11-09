import { types } from 'xstate'
import type { ReadyImageWrite, FailedImageWrite, ArticleImage } from '../../images/schema.js'
import { canWriteImage } from '../../images/schema.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
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
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ImagePublicationFacts }>() } },
			blocked: {},
			done: {},
			insertIntentAndinsertAssetAndpublishImage: {
				schemas: { context: types<{ facts: ImagePublicationFacts }>() }
			}
		},
		guards: {
			canPublishImage: (_, { facts }: { facts: ImagePublicationFacts }) =>
				canWriteImage(facts.image, facts.draft, facts.intent)
		},
		actions: {
			insertIntent: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<ReadyImageWrite, ImagePublicationFacts>
				},
				{ facts }: { facts: ImagePublicationFacts }
			) => io.insertIntent(context.resource, facts),
			insertAsset: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<ReadyImageWrite, ImagePublicationFacts>
				},
				{ facts }: { facts: ImagePublicationFacts }
			) => io.insertAsset(context.resource, facts),
			publishImage: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<ReadyImageWrite, ImagePublicationFacts>
				},
				{ facts }: { facts: ImagePublicationFacts }
			) => io.publishImage(context.resource, facts)
		}
	})
	return model.createMachine({
		id: 'image-publication-domain',
		context: domainContext<ReadyImageWrite, ImagePublicationFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<ReadyImageWrite, ImagePublicationFacts>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.canPublishImage(args, { facts: args.event.output })) {
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
					STAGE: { target: 'insertIntentAndinsertAssetAndpublishImage' }
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
			insertIntentAndinsertAssetAndpublishImage: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertIntent(args, { facts: args.context.facts })
						args.actions.insertAsset(args, { facts: args.context.facts })
						args.actions.publishImage(args, { facts: args.context.facts })
						args.self.send({ type: 'STAGED' })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
export function createImageFailureDomain(io: {
	read: DomainRead<FailedImageWrite, ImageFailureFacts>
	recordFailure: Mutation<ImageFailureFacts>
	receipt: DomainReceipt
}) {
	const model = transactionDomainModel(io.read, 'Image publication unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ImageFailureFacts }>() } },
			blocked: {},
			done: {},
			recordFailure: { schemas: { context: types<{ facts: ImageFailureFacts }>() } }
		},
		guards: {
			canRecordFailure: (_, { facts }: { facts: ImageFailureFacts }) =>
				canWriteImage(facts.image, facts.draft, undefined)
		},
		actions: {
			recordFailure: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<FailedImageWrite, ImageFailureFacts>
				},
				{ facts }: { facts: ImageFailureFacts }
			) => io.recordFailure(context.resource, facts)
		}
	})
	return model.createMachine({
		id: 'image-failure-domain',
		context: domainContext<FailedImageWrite, ImageFailureFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<FailedImageWrite, ImageFailureFacts>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.canRecordFailure(args, { facts: args.event.output })) {
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
