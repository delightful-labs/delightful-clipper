import { types } from 'xstate'
import type { TransactionResource } from '../backend/jazz/transaction.js'
import type { NoteCreate, NoteRevision } from './schema.js'
import { canCreateNote, canImportLegacy, canWriteNoteRevision } from './eligibility.js'
import type { NoteAssociation, LegacyNoteImportRows, NoteRevisionRows } from './eligibility.js'

import { transactionDomainModel, domainContext } from '../machines/storage/domain-model.js'
import type {
	DomainRead as Read,
	DomainMutation as Mutation,
	DomainReceipt as Receipt
} from '../machines/storage/domain-model.js'

export type NoteParentFacts = NoteAssociation & {
	article: unknown
	document: unknown
	request: NoteCreate
}
export type NoteRevisionFacts = NoteRevisionRows & { revision: NoteRevision }
export type NoteImportFacts = LegacyNoteImportRows & NoteParentFacts

export function createNoteCreationMachine(io: {
	read: Read<NoteCreate, NoteParentFacts>
	insertArticle: Mutation<NoteCreate>
	insertDocument: Mutation<NoteCreate>
	receipt: Receipt
}) {
	const model = transactionDomainModel(io.read, 'Note parent or identity unavailable').extend({
		states: {
			reading: {},
			readyArticle: { schemas: { context: types<{ facts: NoteParentFacts }>() } },
			readyDocument: { schemas: { context: types<{ facts: NoteParentFacts }>() } },
			blocked: {},
			done: {},
			insertArticle: { schemas: { context: types<{ facts: NoteParentFacts }>() } },
			insertDocument: { schemas: { context: types<{ facts: NoteParentFacts }>() } }
		},
		guards: {
			canCreateArticleNote: (_, { facts }: { facts: NoteParentFacts }) =>
				canCreateNote(facts, facts.request.id) && !!facts.article,
			canCreateDocumentNote: (_, { facts }: { facts: NoteParentFacts }) =>
				canCreateNote(facts, facts.request.id) && !facts.article && !!facts.document
		},
		actions: {
			insertArticle: (
				{
					context
				}: {
					context: import('../machines/storage/domain-model.js').DomainContext<
						NoteCreate,
						NoteParentFacts
					>
				},
				{ facts }: { facts: NoteParentFacts }
			) => io.insertArticle(context.resource, facts.request),
			insertDocument: (
				{
					context
				}: {
					context: import('../machines/storage/domain-model.js').DomainContext<
						NoteCreate,
						NoteParentFacts
					>
				},
				{ facts }: { facts: NoteParentFacts }
			) => io.insertDocument(context.resource, facts.request)
		}
	})
	return model.createMachine({
		id: 'note-creation-domain',
		context: domainContext<NoteCreate, NoteParentFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('../machines/storage/domain-model.js').DomainContext<
				NoteCreate,
				NoteParentFacts
			>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.canCreateArticleNote(args, { facts: args.event.output })) {
							return { target: 'readyArticle', context: { facts: args.event.output } }
						}
						if (args.guards.canCreateDocumentNote(args, { facts: args.event.output })) {
							return { target: 'readyDocument', context: { facts: args.event.output } }
						}
						return { target: 'blocked' }
					}
				}
			},
			readyArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: { target: 'insertArticle' }
				}
			},
			readyDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: { target: 'insertDocument' }
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
			insertArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertArticle(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertDocument(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
export function createNoteRevisionMachine(io: {
	read: Read<NoteRevision, NoteRevisionFacts>
	insertRevision: Mutation<NoteRevision>
	receipt: Receipt
}) {
	const model = transactionDomainModel(io.read, 'Note or revision unavailable').extend({
		states: {
			reading: {},
			ready: { schemas: { context: types<{ facts: NoteRevisionFacts }>() } },
			blocked: {},
			done: {},
			insertRevision: { schemas: { context: types<{ facts: NoteRevisionFacts }>() } }
		},
		guards: {
			canWriteRevision: (_, { facts }: { facts: NoteRevisionFacts }) =>
				canWriteNoteRevision(facts, facts.revision)
		},
		actions: {
			insertRevision: (
				{
					context
				}: {
					context: import('../machines/storage/domain-model.js').DomainContext<
						NoteRevision,
						NoteRevisionFacts
					>
				},
				{ facts }: { facts: NoteRevisionFacts }
			) => io.insertRevision(context.resource, facts.revision)
		}
	})
	return model.createMachine({
		id: 'note-revision-domain',
		context: domainContext<NoteRevision, NoteRevisionFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('../machines/storage/domain-model.js').DomainContext<
				NoteRevision,
				NoteRevisionFacts
			>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.canWriteRevision(args, { facts: args.event.output })) {
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
					STAGE: { target: 'insertRevision' }
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
			insertRevision: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertRevision(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
export function createLegacyNoteImportMachine(io: {
	read: Read<NoteCreate, NoteImportFacts>
	insertArticle: Mutation<NoteCreate>
	insertDocument: Mutation<NoteCreate>
	insertRevisions: (resource: TransactionResource, revisions: readonly NoteRevision[]) => void
	receipt: Receipt
}) {
	const model = transactionDomainModel(
		io.read,
		'Legacy note import unavailable or already applied'
	).extend({
		states: {
			reading: {},
			readyExisting: { schemas: { context: types<{ facts: NoteImportFacts }>() } },
			readyArticle: { schemas: { context: types<{ facts: NoteImportFacts }>() } },
			readyDocument: { schemas: { context: types<{ facts: NoteImportFacts }>() } },
			blocked: {},
			done: {},
			insertRevisions: { schemas: { context: types<{ facts: NoteImportFacts }>() } },
			insertArticleAndinsertRevisions: {
				schemas: { context: types<{ facts: NoteImportFacts }>() }
			},
			insertDocumentAndinsertRevisions: {
				schemas: { context: types<{ facts: NoteImportFacts }>() }
			}
		},
		guards: {
			canImportExistingNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.note,
			canImportArticleNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.article,
			canImportDocumentNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.document
		},
		actions: {
			insertArticle: (
				{
					context
				}: {
					context: import('../machines/storage/domain-model.js').DomainContext<
						NoteCreate,
						NoteImportFacts
					>
				},
				{ facts }: { facts: NoteImportFacts }
			) => io.insertArticle(context.resource, facts.request),
			insertDocument: (
				{
					context
				}: {
					context: import('../machines/storage/domain-model.js').DomainContext<
						NoteCreate,
						NoteImportFacts
					>
				},
				{ facts }: { facts: NoteImportFacts }
			) => io.insertDocument(context.resource, facts.request),
			insertRevisions: (
				{
					context
				}: {
					context: import('../machines/storage/domain-model.js').DomainContext<
						NoteCreate,
						NoteImportFacts
					>
				},
				{ facts }: { facts: NoteImportFacts }
			) => io.insertRevisions(context.resource, facts.missing)
		}
	})
	return model.createMachine({
		id: 'note-import-domain',
		context: domainContext<NoteCreate, NoteImportFacts>,
		initial: 'reading',
		output: ({
			context
		}: {
			context: import('../machines/storage/domain-model.js').DomainContext<
				NoteCreate,
				NoteImportFacts
			>
		}) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: (args) => {
						if (args.guards.canImportExistingNote(args, { facts: args.event.output })) {
							return { target: 'readyExisting', context: { facts: args.event.output } }
						}
						if (args.guards.canImportArticleNote(args, { facts: args.event.output })) {
							return { target: 'readyArticle', context: { facts: args.event.output } }
						}
						if (args.guards.canImportDocumentNote(args, { facts: args.event.output })) {
							return { target: 'readyDocument', context: { facts: args.event.output } }
						}
						return { target: 'blocked' }
					}
				}
			},
			readyExisting: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: { target: 'insertRevisions' }
				}
			},
			readyArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: { target: 'insertArticleAndinsertRevisions' }
				}
			},
			readyDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: { target: 'insertDocumentAndinsertRevisions' }
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
			insertRevisions: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertRevisions(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertArticleAndinsertRevisions: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertArticle(args, { facts: args.context.facts })
						args.actions.insertRevisions(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			},
			insertDocumentAndinsertRevisions: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertDocument(args, { facts: args.context.facts })
						args.actions.insertRevisions(args, { facts: args.context.facts })
					})
					enq.sendTo(args.self, { type: 'STAGED' })
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
