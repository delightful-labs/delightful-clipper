import type { z } from 'zod'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { app } from './schema.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import {
	noteCreateSchema,
	noteSchema,
	noteHistorySchema,
	noteRevisionSchema,
	storedNoteHistorySchema,
	storedNoteRevisionSchema,
	sameNoteRevision,
	projectNote
} from '../../notes/schema.js'
import type { Note, NoteCreate, NoteRevision } from '../../notes/schema.js'
import { storedArticleNoteHistorySchema } from '../../notes/legacy.js'
import {
	belongsToArticle,
	hasUnusedRevisionId,
	matchesNoteOperation
} from '../../notes/eligibility.js'
import { createNoteOperation } from '../../notes/operation-machine.js'
import {
	createNoteCreationMachine,
	createNoteRevisionMachine,
	createLegacyNoteImportMachine
} from '../../notes/domain-machines.js'
import type { NoteImportFacts } from '../../notes/domain-machines.js'
import { articleTargets } from '../../capture/causal.js'

function noteObserver<T>(schema: z.ZodType<T>, next: (rows: T) => void, error: () => void) {
	return {
		onUpdate: (rows: unknown) => {
			const parsed = schema.safeParse(rows)
			if (!parsed.success) {
				error()
				return
			}
			next(parsed.data)
		},
		onError: error
	}
}
/** Entity creation, source writes and legacy import each have one DLF transaction
 * owner. IDs are supplied by the caller's operation owner and never derived from
 * an article, account-provider identifier or external protocol address. */
export function createNoteRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const lifecycle = transactionLifecycle(db, isCurrent)
	const readAssociation = async (resource: TransactionResource, targetId: string) => {
		const tx = resource.tx
		const library = await tx.one(app.libraries.where({ id: libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const article = await tx.one(app.articles.where({ id: targetId, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const document = await tx.one(app.documents.where({ id: targetId, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const aliases = await tx.all(
			app.articles.where({ libraryId, contentId: article?.contentId ?? targetId }),
			{ tier: ReadTier.LocalFirst }
		)
		const notes = noteHistorySchema.parse(
			await tx.all(app.notes.where({ libraryId }), { tier: ReadTier.LocalFirst })
		)
		return {
			library,
			article,
			document,
			parent: article ?? document,
			targets: articleTargets(targetId, article?.contentId ?? document?.id ?? null, aliases),
			notes
		}
	}
	function validateCreate(input: unknown, operationId: string) {
		const request = noteCreateSchema.parse(input)
		if (!matchesNoteOperation(request, libraryId, operationId))
			throw new Error('Invalid note scope')
		return request
	}
	function validateRevision(input: unknown, operationId: string) {
		const revision = noteRevisionSchema.parse(input)
		if (!matchesNoteOperation(revision, libraryId, operationId))
			throw new Error('Invalid note scope')
		return revision
	}
	function insertRevision(resource: TransactionResource, { id, ...revision }: NoteRevision) {
		resource.tx.insert(
			app.noteRevisions,
			{ ...revision, parents: JSON.stringify(revision.parents) },
			{ id }
		)
	}
	function insertArticle(resource: TransactionResource, request: NoteCreate) {
		resource.tx.insert(
			app.notes,
			{ libraryId, articleId: request.articleId, documentId: null },
			{ id: request.id }
		)
	}
	function insertDocument(resource: TransactionResource, request: NoteCreate) {
		resource.tx.insert(
			app.notes,
			{ libraryId, articleId: null, documentId: request.articleId },
			{ id: request.id }
		)
	}
	async function readCreation(
		resource: TransactionResource,
		input: NoteCreate,
		operationId: string
	) {
		const request = validateCreate(input, operationId)
		return { ...(await readAssociation(resource, request.articleId)), request }
	}
	async function readRevisionFacts(
		resource: TransactionResource,
		input: NoteRevision,
		operationId: string
	) {
		const revision = validateRevision(input, operationId)
		const row = await resource.tx.one(app.notes.where({ id: revision.noteId, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const history = storedNoteHistorySchema.parse(
			await resource.tx.all(app.noteRevisions.where({ libraryId }), { tier: ReadTier.LocalFirst })
		)
		return { note: row ? noteSchema.parse(row) : null, history, revision }
	}
	async function readImport(
		resource: TransactionResource,
		input: NoteCreate,
		operationId: string
	): Promise<NoteImportFacts> {
		const request = validateCreate(input, operationId)
		const rows = await readAssociation(resource, request.articleId)
		const note = rows.notes.find((row) => row.id === request.id) ?? null
		const source = storedArticleNoteHistorySchema
			.parse(
				await resource.tx.all(app.articleNoteRevisions.where({ libraryId }), {
					tier: ReadTier.LocalFirst
				})
			)
			.filter((row) => rows.targets.has(row.articleId))
		const history = storedNoteHistorySchema.parse(
			await resource.tx.all(app.noteRevisions.where({ libraryId }), { tier: ReadTier.LocalFirst })
		)
		const expected = source.map(({ articleId: _article, ...row }) => ({
			...row,
			noteId: request.id
		}))
		const knownIds = new Set(history.map((row) => row.id))
		const missing = expected.filter((row) => hasUnusedRevisionId(knownIds, row.id))
		return { ...rows, request, note, source, history, expected, missing }
	}
	const create = createNoteOperation<NoteCreate>(
		createNoteCreationMachine({
			read: readCreation,
			insertArticle,
			insertDocument,
			receipt: transactionReceipt
		}),
		lifecycle
	)
	const stage = createNoteOperation<NoteRevision>(
		createNoteRevisionMachine({
			read: readRevisionFacts,
			insertRevision,
			receipt: transactionReceipt
		}),
		lifecycle
	)
	const importLegacy = createNoteOperation<NoteCreate>(
		createLegacyNoteImportMachine({
			read: readImport,
			insertArticle,
			insertDocument,
			insertRevisions: (resource, revisions) => {
				for (const revision of revisions) insertRevision(resource, revision)
			},
			receipt: transactionReceipt
		}),
		lifecycle
	)
	const read = async (noteId: string) => {
		const row = await db.one(app.notes.where({ id: noteId, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		return row ? noteSchema.parse(row) : null
	}
	const targetsForArticle = async (id: string) => {
		const article = await db.one(app.articles.where({ id, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const aliases = await db.all(
			app.articles.where({ libraryId, contentId: article?.contentId ?? id }),
			{ tier: ReadTier.LocalFirst }
		)
		return articleTargets(id, article?.contentId ?? id, aliases)
	}
	return {
		create,
		stage,
		importLegacy,
		isCurrent,
		libraryId,
		read,
		recoveryTarget: async (id: string) => {
			const note = await read(id)
			if (!note) return null
			return {
				note,
				articleIds: [...(await targetsForArticle(note.articleId ?? note.documentId!))]
			}
		},
		forArticle: async (id: string) => {
			const targets = await targetsForArticle(id)
			return noteHistorySchema
				.parse(await db.all(app.notes.where({ libraryId }), { tier: ReadTier.LocalFirst }))
				.filter((note) => belongsToArticle(note, targets))
		},
		content: async (noteId: string) =>
			projectNote(
				{ libraryId, noteId },
				storedNoteHistorySchema.parse(
					await db.all(app.noteRevisions.where({ noteId, libraryId }), {
						tier: ReadTier.LocalFirst
					})
				)
			),
		readRevision: async (revision: NoteRevision) => {
			const row = await db.one(app.noteRevisions.where({ id: revision.id, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			if (!row) return null
			const parsed = storedNoteRevisionSchema.parse(row)
			if (!sameNoteRevision(parsed, revision)) throw new Error('Invalid note operation')
			return parsed
		},
		legacy: async () =>
			storedArticleNoteHistorySchema.parse(
				await db.all(app.articleNoteRevisions.where({ libraryId }), { tier: ReadTier.LocalFirst })
			),
		subscribe: (next: (rows: NoteRevision[]) => void, error: () => void) =>
			db.subscribe(
				app.noteRevisions.where({ libraryId }),
				noteObserver(storedNoteHistorySchema, next, error),
				{ tier: ReadTier.LocalFirst }
			),
		subscribeNotes: (next: (rows: Note[]) => void, error: () => void) =>
			db.subscribe(app.notes.where({ libraryId }), noteObserver(noteHistorySchema, next, error), {
				tier: ReadTier.LocalFirst
			})
	}
}
