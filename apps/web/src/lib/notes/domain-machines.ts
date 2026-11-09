import type { TransactionResource } from '../backend/jazz/transaction.js'
import type { NoteCreate, NoteRevision } from './schema.js'
import { canCreateNote, canImportLegacy, canWriteNoteRevision } from './eligibility.js'
import type { NoteAssociation, LegacyNoteImportRows, NoteRevisionRows } from './eligibility.js'
import { required } from '../machines/storage/domain-transaction.js'

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
		guards: {
			canCreateArticleNote: (_, { facts }: { facts: NoteParentFacts }) =>
				canCreateNote(facts, facts.request.id) && !!facts.article,
			canCreateDocumentNote: (_, { facts }: { facts: NoteParentFacts }) =>
				canCreateNote(facts, facts.request.id) && !facts.article && !!facts.document
		},
		actions: {
			insertArticle: ({
				context
			}: {
				context: import('../machines/storage/domain-model.js').DomainContext<
					NoteCreate,
					NoteParentFacts
				>
			}) => io.insertArticle(context.resource, required(context.facts).request),
			insertDocument: ({
				context
			}: {
				context: import('../machines/storage/domain-model.js').DomainContext<
					NoteCreate,
					NoteParentFacts
				>
			}) => io.insertDocument(context.resource, required(context.facts).request)
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.canCreateArticleNote(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							)
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'readyArticle', context: patch }
						}
						if (
							args.guards.canCreateDocumentNote(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							)
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'readyDocument', context: patch }
						}
						return { target: 'blocked', context: patch }
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
					STAGE: (_args, _enq) => {
						let patch = {}
						return { target: 'insertArticle', context: patch }
					}
				}
			},
			readyDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: (_args, _enq) => {
						let patch = {}
						return { target: 'insertDocument', context: patch }
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
			insertArticle: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertArticle(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			insertDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertDocument(args)
						args.self.send({ type: 'STAGED' as const })
					})
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
		guards: {
			canWriteRevision: (_, { facts }: { facts: NoteRevisionFacts }) =>
				canWriteNoteRevision(facts, facts.revision)
		},
		actions: {
			insertRevision: ({
				context
			}: {
				context: import('../machines/storage/domain-model.js').DomainContext<
					NoteRevision,
					NoteRevisionFacts
				>
			}) => io.insertRevision(context.resource, required(context.facts).revision)
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.canWriteRevision(args, (({ event }) => ({ facts: event.output }))(args))
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
						return { target: 'insertRevision', context: patch }
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
			insertRevision: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertRevision(args)
						args.self.send({ type: 'STAGED' as const })
					})
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
		guards: {
			canImportExistingNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.note,
			canImportArticleNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.article,
			canImportDocumentNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.document
		},
		actions: {
			insertArticle: ({
				context
			}: {
				context: import('../machines/storage/domain-model.js').DomainContext<
					NoteCreate,
					NoteImportFacts
				>
			}) => io.insertArticle(context.resource, required(context.facts).request),
			insertDocument: ({
				context
			}: {
				context: import('../machines/storage/domain-model.js').DomainContext<
					NoteCreate,
					NoteImportFacts
				>
			}) => io.insertDocument(context.resource, required(context.facts).request),
			insertRevisions: ({
				context
			}: {
				context: import('../machines/storage/domain-model.js').DomainContext<
					NoteCreate,
					NoteImportFacts
				>
			}) => io.insertRevisions(context.resource, required(context.facts).missing)
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
					onDone: (args, _enq) => {
						let patch = {}
						if (
							args.guards.canImportExistingNote(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							)
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'readyExisting', context: patch }
						}
						if (
							args.guards.canImportArticleNote(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							)
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'readyArticle', context: patch }
						}
						if (
							args.guards.canImportDocumentNote(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							)
						) {
							patch = args.actions.rememberFacts(
								args,
								(({ event }) => ({ facts: event.output }))(args)
							).context
							return { target: 'readyDocument', context: patch }
						}
						return { target: 'blocked', context: patch }
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
					STAGE: (_args, _enq) => {
						let patch = {}
						return { target: 'insertRevisions', context: patch }
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
					STAGE: (_args, _enq) => {
						let patch = {}
						return { target: 'insertArticleAndinsertRevisions', context: patch }
					}
				}
			},
			readyDocument: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.allow(args)
					})
				},
				on: {
					STAGE: (_args, _enq) => {
						let patch = {}
						return { target: 'insertDocumentAndinsertRevisions', context: patch }
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
			insertRevisions: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertRevisions(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			insertArticleAndinsertRevisions: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertArticle(args)
						args.actions.insertRevisions(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			},
			insertDocumentAndinsertRevisions: {
				entry: (args, enq) => {
					enq(() => {
						args.actions.insertDocument(args)
						args.actions.insertRevisions(args)
						args.self.send({ type: 'STAGED' as const })
					})
				},
				on: { STAGED: { target: 'done' } }
			}
		}
	})
}
