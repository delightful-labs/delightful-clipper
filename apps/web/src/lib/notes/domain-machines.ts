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
					onDone: [
						{
							guard: {
								type: 'canCreateArticleNote',
								params: ({ event }) => ({ facts: event.output })
							},
							target: 'readyArticle',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{
							guard: {
								type: 'canCreateDocumentNote',
								params: ({ event }) => ({ facts: event.output })
							},
							target: 'readyDocument',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{ target: 'blocked' }
					]
				}
			},
			readyArticle: { entry: 'allow', on: { STAGE: { target: 'done', actions: 'insertArticle' } } },
			readyDocument: {
				entry: 'allow',
				on: { STAGE: { target: 'done', actions: 'insertDocument' } }
			},
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
			canWriteRevision: (_, { facts }: { facts: NoteRevisionFacts }) =>
				canWriteNoteRevision(facts, facts.revision)
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
					onDone: [
						{
							guard: { type: 'canWriteRevision', params: ({ event }) => ({ facts: event.output }) },
							target: 'ready',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{ target: 'blocked' }
					]
				}
			},
			ready: { entry: 'allow', on: { STAGE: { target: 'done', actions: 'insertRevision' } } },
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
			canImportExistingNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.note,
			canImportArticleNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.article,
			canImportDocumentNote: (_, { facts }: { facts: NoteImportFacts }) =>
				canImportLegacy(facts) && !!facts.document
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
					onDone: [
						{
							guard: {
								type: 'canImportExistingNote',
								params: ({ event }) => ({ facts: event.output })
							},
							target: 'readyExisting',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{
							guard: {
								type: 'canImportArticleNote',
								params: ({ event }) => ({ facts: event.output })
							},
							target: 'readyArticle',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{
							guard: {
								type: 'canImportDocumentNote',
								params: ({ event }) => ({ facts: event.output })
							},
							target: 'readyDocument',
							actions: { type: 'rememberFacts', params: ({ event }) => ({ facts: event.output }) }
						},
						{ target: 'blocked' }
					]
				}
			},
			readyExisting: {
				entry: 'allow',
				on: { STAGE: { target: 'done', actions: ['insertRevisions'] } }
			},
			readyArticle: {
				entry: 'allow',
				on: { STAGE: { target: 'done', actions: ['insertArticle', 'insertRevisions'] } }
			},
			readyDocument: {
				entry: 'allow',
				on: { STAGE: { target: 'done', actions: ['insertDocument', 'insertRevisions'] } }
			},
			blocked: { entry: 'block' },
			done: { type: 'final' }
		}
	})
}
