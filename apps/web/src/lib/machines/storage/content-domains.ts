import { types } from 'xstate'
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
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ContentFacts }>() } },
			blocked: {},
			done: {},
			insertIntentAndbindArticle: { schemas: { context: types<{ facts: ContentFacts }>() } },
			insertIntentAndcreateArticle: { schemas: { context: types<{ facts: ContentFacts }>() } },
			insertIntent: { schemas: { context: types<{ facts: ContentFacts }>() } }
		},
		guards: {
			canBindIntent: (_, params: { facts: ContentFacts }) => canBindStorageIntent(params.facts),
			articleLinked: (_, { facts }: { facts: ContentFacts }) => hasLinkedArticle(facts),
			articleExists: (_, { facts }: { facts: ContentFacts }) => hasExistingArticle(facts)
		},
		actions: {
			insertIntent: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
				},
				{ facts }: { facts: ContentFacts }
			) => io.insertIntent(context.resource, facts),
			bindArticle: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
				},
				{ facts }: { facts: ContentFacts }
			) => io.bindArticle(context.resource, facts),
			createArticle: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
				},
				{ facts }: { facts: ContentFacts }
			) => io.createArticle(context.resource, facts)
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
					onDone: (args) => {
						if (args.guards.canBindIntent(args, { facts: args.event.output })) {
							return { target: 'ready', context: { facts: args.event.output } }
						}
						return { target: 'blocked', context: { facts: args.event.output } }
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
							args.guards.articleLinked(args, { facts: args.context.facts }) &&
							args.guards.articleExists(args, { facts: args.context.facts })
						) {
							return { target: 'insertIntentAndbindArticle' }
						}
						if (args.guards.articleLinked(args, { facts: args.context.facts })) {
							return { target: 'insertIntentAndcreateArticle' }
						}
						return { target: 'insertIntent' }
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
			insertIntentAndbindArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertIntent(args, { facts: args.context.facts })
						args.actions.bindArticle(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertIntentAndcreateArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertIntent(args, { facts: args.context.facts })
						args.actions.createArticle(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertIntent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertIntent(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
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
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: ContentFacts }>() } },
			blocked: {},
			done: {},
			publishContentAndattachContentAndpublishSource: {
				schemas: { context: types<{ facts: ContentFacts }>() }
			},
			publishContentAndattachContent: { schemas: { context: types<{ facts: ContentFacts }>() } },
			publishContentAndpublishSource: { schemas: { context: types<{ facts: ContentFacts }>() } },
			publishContent: { schemas: { context: types<{ facts: ContentFacts }>() } }
		},
		guards: {
			canPublishContent: (_, params: { facts: ContentFacts }) =>
				canPublishStoredContent(params.facts),
			articleLinked: (_, { facts }: { facts: ContentFacts }) => hasLinkedArticle(facts),
			hasSource: (_, { facts }: { facts: ContentFacts }) => hasContentSource(facts)
		},
		actions: {
			publishContent: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
				},
				{ facts }: { facts: ContentFacts }
			) => io.publishContent(context.resource, facts),
			attachContent: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
				},
				{ facts }: { facts: ContentFacts }
			) => io.attachContent(context.resource, facts),
			publishSource: (
				{
					context
				}: {
					context: import('./domain-model.js').DomainContext<PreparedSave, ContentFacts>
				},
				{ facts }: { facts: ContentFacts }
			) => io.publishSource(context.resource, facts)
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
					onDone: (args) => {
						if (args.guards.canPublishContent(args, { facts: args.event.output })) {
							return { target: 'ready', context: { facts: args.event.output } }
						}
						return { target: 'blocked', context: { facts: args.event.output } }
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
							args.guards.articleLinked(args, { facts: args.context.facts }) &&
							args.guards.hasSource(args, { facts: args.context.facts })
						) {
							return { target: 'publishContentAndattachContentAndpublishSource' }
						}
						if (args.guards.articleLinked(args, { facts: args.context.facts })) {
							return { target: 'publishContentAndattachContent' }
						}
						if (args.guards.hasSource(args, { facts: args.context.facts })) {
							return { target: 'publishContentAndpublishSource' }
						}
						return { target: 'publishContent' }
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
			publishContentAndattachContentAndpublishSource: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.publishContent(args, { facts: args.context.facts })
						args.actions.attachContent(args, { facts: args.context.facts })
						args.actions.publishSource(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			publishContentAndattachContent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.publishContent(args, { facts: args.context.facts })
						args.actions.attachContent(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			publishContentAndpublishSource: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.publishContent(args, { facts: args.context.facts })
						args.actions.publishSource(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			publishContent: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.publishContent(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
