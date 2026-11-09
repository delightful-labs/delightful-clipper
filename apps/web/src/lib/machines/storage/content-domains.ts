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
			insertIntent: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
			}) => io.insertIntent(context.resource, required(context.facts)),
			bindArticle: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
			}) => io.bindArticle(context.resource, required(context.facts)),
			createArticle: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
			}) => io.createArticle(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'content-intent-domain',
		context: domainContext<PreparedSave, ContentFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args, _enq) => {
						let patch = {}
						if (args.guards.canBindIntent(args, (({ event }) => ({ facts: event.output }))(args))) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'ready', context: patch }
						}
						patch = args.actions.rememberFacts(
							args,
							(({ event }) => ({ facts: event.output }))(args)
						).context
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
						if (args.guards.articleLinked(args) && args.guards.articleExists(args)) {
							return { target: 'insertIntentAndbindArticle', context: patch }
						}
						if (args.guards.articleLinked(args)) {
							return { target: 'insertIntentAndcreateArticle', context: patch }
						}
						return { target: 'insertIntent', context: patch }
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
			done: { type: 'final' as const },
			insertIntentAndbindArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertIntent(args)
						args.actions.bindArticle(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			insertIntentAndcreateArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertIntent(args)
						args.actions.createArticle(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			insertIntent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertIntent(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
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
			publishContent: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
			}) => io.publishContent(context.resource, required(context.facts)),
			attachContent: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
			}) => io.attachContent(context.resource, required(context.facts)),
			publishSource: ({
				context
			}: {
				context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
			}) => io.publishSource(context.resource, required(context.facts))
		}
	})
	return model.createMachine({
		id: 'content-publication-domain',
		context: domainContext<PreparedSave, ContentFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.canPublishContent(args, (({ event }) => ({ facts: event.output }))(args))
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'ready', context: patch }
						}
						patch = args.actions.rememberFacts(
							args,
							(({ event }) => ({ facts: event.output }))(args)
						).context
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
						if (args.guards.articleLinked(args) && args.guards.hasSource(args)) {
							return { target: 'publishContentAndattachContentAndpublishSource', context: patch }
						}
						if (args.guards.articleLinked(args)) {
							return { target: 'publishContentAndattachContent', context: patch }
						}
						if (args.guards.hasSource(args)) {
							return { target: 'publishContentAndpublishSource', context: patch }
						}
						return { target: 'publishContent', context: patch }
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
			done: { type: 'final' as const },
			publishContentAndattachContentAndpublishSource: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.publishContent(args)
						args.actions.attachContent(args)
						args.actions.publishSource(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			publishContentAndattachContent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.publishContent(args)
						args.actions.attachContent(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			publishContentAndpublishSource: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.publishContent(args)
						args.actions.publishSource(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			publishContent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.publishContent(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
