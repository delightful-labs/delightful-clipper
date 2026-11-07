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
			canCreateNote: ({ context }) =>
				canCreateNote(required(context.facts), required(context.facts).request.id),
			hasArticleParent: ({ context }) => !!required(context.facts).article,
			hasDocumentParent: ({ context }) => !!required(context.facts).document
		},
		actions: {
			insertArticle: ({ context }) =>
				io.insertArticle(context.resource, required(context.facts).request),
			insertDocument: ({ context }) =>
				io.insertDocument(context.resource, required(context.facts).request)
		}
	})
	return model.createMachine({
		id: 'note-creation-domain',
		context: domainContext<NoteCreate, NoteParentFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingCreation',
						actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
					}
				}
			},
			checkingCreation: {
				always: [{ guard: 'canCreateNote', target: 'selectingParent' }, { target: 'blocked' }]
			},
			selectingParent: {
				always: [
					{ guard: 'hasArticleParent', target: 'readyArticle' },
					{ guard: 'hasDocumentParent', target: 'readyDocument' },
					{ target: 'blocked' }
				]
			},
			readyArticle: { entry: 'allow', on: { STAGE: 'insertingArticle' } },
			readyDocument: { entry: 'allow', on: { STAGE: 'insertingDocument' } },
			insertingArticle: { entry: 'insertArticle', always: 'done' },
			insertingDocument: { entry: 'insertDocument', always: 'done' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
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
			canWriteRevision: ({ context }) =>
				canWriteNoteRevision(required(context.facts), required(context.facts).revision)
		},
		actions: {
			insertRevision: ({ context }) =>
				io.insertRevision(context.resource, required(context.facts).revision)
		}
	})
	return model.createMachine({
		id: 'note-revision-domain',
		context: domainContext<NoteRevision, NoteRevisionFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingRevision',
						actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
					}
				}
			},
			checkingRevision: {
				always: [{ guard: 'canWriteRevision', target: 'ready' }, { target: 'blocked' }]
			},
			ready: { entry: 'allow', on: { STAGE: 'insertingRevision' } },
			insertingRevision: { entry: 'insertRevision', always: 'done' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
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
			canImportLegacy: ({ context }) => canImportLegacy(required(context.facts)),
			hasExistingNote: ({ context }) => !!required(context.facts).note,
			hasArticleParent: ({ context }) => !!required(context.facts).article,
			hasDocumentParent: ({ context }) => !!required(context.facts).document
		},
		actions: {
			insertArticle: ({ context }) =>
				io.insertArticle(context.resource, required(context.facts).request),
			insertDocument: ({ context }) =>
				io.insertDocument(context.resource, required(context.facts).request),
			insertRevisions: ({ context }) =>
				io.insertRevisions(context.resource, required(context.facts).missing)
		}
	})
	return model.createMachine({
		id: 'note-import-domain',
		context: domainContext<NoteCreate, NoteImportFacts>,
		initial: 'reading',
		output: ({ context }) => io.receipt(context.resource),
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingImport',
						actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
					}
				}
			},
			checkingImport: {
				always: [{ guard: 'canImportLegacy', target: 'selectingParent' }, { target: 'blocked' }]
			},
			selectingParent: {
				always: [
					{ guard: 'hasExistingNote', target: 'readyExisting' },
					{ guard: 'hasArticleParent', target: 'readyArticle' },
					{ guard: 'hasDocumentParent', target: 'readyDocument' },
					{ target: 'blocked' }
				]
			},
			readyExisting: { entry: 'allow', on: { STAGE: 'importingRevisions' } },
			readyArticle: { entry: 'allow', on: { STAGE: 'insertingArticle' } },
			readyDocument: { entry: 'allow', on: { STAGE: 'insertingDocument' } },
			insertingArticle: { entry: 'insertArticle', always: 'importingRevisions' },
			insertingDocument: { entry: 'insertDocument', always: 'importingRevisions' },
			importingRevisions: { entry: 'insertRevisions', always: 'done' },
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
