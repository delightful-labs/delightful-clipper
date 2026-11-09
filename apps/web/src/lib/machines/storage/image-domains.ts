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
			canPublishImage: (_, { facts }: { facts: ImagePublicationFacts }) =>
				canWriteImage(facts.image, facts.draft, facts.intent)
		},
		actions: {
			insertIntent: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<ReadyImageWrite, ImagePublicationFacts>
			}) => io.insertIntent(context.resource, required(context.facts)),
			insertAsset: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<ReadyImageWrite, ImagePublicationFacts>
			}) => io.insertAsset(context.resource, required(context.facts)),
			publishImage: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<ReadyImageWrite, ImagePublicationFacts>
			}) => io.publishImage(context.resource, required(context.facts))
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.canPublishImage(args, (({ event }) => ({ facts: event.output }))(args))
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
						return { target: 'insertIntentAndinsertAssetAndpublishImage', context: patch }
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
			done: { type: 'final' },
			insertIntentAndinsertAssetAndpublishImage: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertIntent(args)
						args.actions.insertAsset(args)
						args.actions.publishImage(args)
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
		guards: {
			canRecordFailure: (_, { facts }: { facts: ImageFailureFacts }) =>
				canWriteImage(facts.image, facts.draft, undefined)
		},
		actions: {
			recordFailure: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<FailedImageWrite, ImageFailureFacts>
			}) => io.recordFailure(context.resource, required(context.facts))
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.canRecordFailure(args, (({ event }) => ({ facts: event.output }))(args))
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
			done: { type: 'final' },
			recordFailure: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.recordFailure(args)
						args.self.send({ type: 'STAGED' })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
