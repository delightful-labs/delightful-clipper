import { ReadTier } from 'jazz-tools'
import type { Db, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { app } from './schema.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import type { SyncReceipt } from '../../contracts/storage.js'
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
import type { ArticleNoteRevision as LegacyRevision } from '../../notes/legacy.js'
import { articleTargets } from '../../capture/causal.js'
import { stageNoteParent } from '../../machines/storage/note-parent.js'

type Resource = TransactionResource & {
	noteDocument?: unknown
	note?: Note | null
	imported?: NoteRevision[]
}
type Association = { library: unknown; parent: unknown; targets: Set<string>; notes: Note[] }
function belongsToArticle(note: Note, targets: ReadonlySet<string>) {
	return targets.has(note.articleId ?? note.documentId ?? '')
}
function canCreateNote(rows: Association) {
	return (
		!!rows.library &&
		!!rows.parent &&
		!rows.notes.some((note) => belongsToArticle(note, rows.targets))
	)
}
function canWriteNoteRevision(
	rows: { note: Note | null; history: NoteRevision[] },
	revision: NoteRevision
) {
	if (!rows.note || rows.history.some((row) => row.id === revision.id)) return false
	const parents = new Set(
		rows.history.filter((row) => row.noteId === revision.noteId).map((row) => row.id)
	)
	return revision.parents.every((id) => parents.has(id))
}
function canImportLegacy(
	rows: Association & {
		note: Note | null
		source: LegacyRevision[]
		history: NoteRevision[]
		expected: NoteRevision[]
		missing: NoteRevision[]
	}
) {
	if (!rows.library || !rows.parent || !rows.source.length || !rows.missing.length) return false
	if (rows.note && !belongsToArticle(rows.note, rows.targets)) return false
	if (!rows.note && rows.notes.some((note) => belongsToArticle(note, rows.targets))) return false
	const known = new Map(rows.history.map((revision) => [revision.id, revision]))
	if (
		rows.expected.some(
			(revision) => known.has(revision.id) && !sameNoteRevision(known.get(revision.id)!, revision)
		)
	)
		return false
	const validParents = new Set([
		...rows.expected.map((row) => row.id),
		...rows.history.filter((row) => row.noteId === rows.expected[0]?.noteId).map((row) => row.id)
	])
	return rows.expected.every((row) => row.parents.every((id) => validParents.has(id)))
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
	const readAssociation = async (resource: Resource, targetId: string): Promise<Association> => {
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
		resource.article = article
		resource.noteDocument = document
		const aliases = await tx.all(
			app.articles.where({ libraryId, contentId: article?.contentId ?? targetId }),
			{ tier: ReadTier.LocalFirst }
		)
		const notes = noteHistorySchema.parse(
			await tx.all(app.notes.where({ libraryId }), { tier: ReadTier.LocalFirst })
		)
		return {
			library,
			parent: article ?? document,
			targets: articleTargets(targetId, article?.contentId ?? document?.id ?? null, aliases),
			notes
		}
	}
	function validateCreate(input: unknown, operationId: string) {
		const request = noteCreateSchema.parse(input)
		if (request.libraryId !== libraryId || request.id !== operationId)
			throw new Error('Invalid note scope')
		return request
	}
	function insertNote(resource: Resource, request: NoteCreate) {
		return stageNoteParent({
			note: resource.note,
			article: resource.article,
			document: resource.noteDocument,
			insertArticle: () =>
				resource.tx.insert(
					app.notes,
					{ libraryId, articleId: request.articleId, documentId: null },
					{ id: request.id }
				),
			insertDocument: () =>
				resource.tx.insert(
					app.notes,
					{ libraryId, articleId: null, documentId: request.articleId },
					{ id: request.id }
				),
			receipt: () => transactionReceipt(resource)
		})
	}
	const create = createWorkspaceCreationTransaction<
		NoteCreate,
		Resource,
		Association & { unused: boolean },
		SyncReceipt,
		WriteHandle
	>({
		...lifecycle,
		readLocal: async (resource, attempt) => {
			const request = validateCreate(attempt.draft, attempt.operationId)
			const rows = await readAssociation(resource, request.articleId)
			return { ...rows, unused: !rows.notes.some((note) => note.id === request.id) }
		},
		assess: (rows) =>
			canCreateNote(rows) && rows.unused
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Note parent or identity unavailable' },
		stage: (resource, attempt) =>
			insertNote(resource, validateCreate(attempt.draft, attempt.operationId))
	})
	const stage = createWorkspaceCreationTransaction<
		NoteRevision,
		Resource,
		{ note: Note | null; history: NoteRevision[] },
		SyncReceipt,
		WriteHandle
	>({
		...lifecycle,
		readLocal: async (resource, attempt) => {
			const revision = noteRevisionSchema.parse(attempt.draft)
			if (revision.libraryId !== libraryId || revision.id !== attempt.operationId)
				throw new Error('Invalid note scope')
			const row = await resource.tx.one(app.notes.where({ id: revision.noteId, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			const history = storedNoteHistorySchema.parse(
				await resource.tx.all(app.noteRevisions.where({ libraryId }), { tier: ReadTier.LocalFirst })
			)
			return { note: row ? noteSchema.parse(row) : null, history }
		},
		assess: (rows, attempt) => {
			return canWriteNoteRevision(rows, attempt.draft)
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Note or revision unavailable' }
		},
		stage: (resource, attempt) => {
			const { id, ...revision } = noteRevisionSchema.parse(attempt.draft)
			resource.tx.insert(
				app.noteRevisions,
				{ ...revision, parents: JSON.stringify(revision.parents) },
				{ id }
			)
			return transactionReceipt(resource)
		}
	})
	type ImportRows = Association & {
		note: Note | null
		source: LegacyRevision[]
		history: NoteRevision[]
		expected: NoteRevision[]
		missing: NoteRevision[]
	}
	const importLegacy = createWorkspaceCreationTransaction<
		NoteCreate,
		Resource,
		ImportRows,
		SyncReceipt,
		WriteHandle
	>({
		...lifecycle,
		readLocal: async (resource, attempt) => {
			const request = validateCreate(attempt.draft, attempt.operationId)
			const rows = await readAssociation(resource, request.articleId)
			const note = rows.notes.find((row) => row.id === request.id) ?? null
			resource.note = note
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
			const seen = new Set(history.map((row) => row.id))
			const missing = expected.filter((row) => !seen.has(row.id))
			resource.imported = missing
			return { ...rows, note, source, history, expected, missing }
		},
		assess: (rows) =>
			canImportLegacy(rows)
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Legacy note import unavailable or already applied' },
		stage: async (resource, attempt) => {
			await insertNote(resource, validateCreate(attempt.draft, attempt.operationId))
			if (!resource.imported) throw new Error('Missing checked note import')
			for (const { id, ...revision } of resource.imported)
				resource.tx.insert(
					app.noteRevisions,
					{ ...revision, parents: JSON.stringify(revision.parents) },
					{ id }
				)
			return transactionReceipt(resource)
		}
	})
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
				{
					onUpdate: (rows) => {
						const parsed = storedNoteHistorySchema.safeParse(rows)
						if (!parsed.success) {
							error()
							return
						}
						next(parsed.data)
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			),
		subscribeNotes: (next: (rows: Note[]) => void, error: () => void) =>
			db.subscribe(
				app.notes.where({ libraryId }),
				{
					onUpdate: (rows) => {
						const parsed = noteHistorySchema.safeParse(rows)
						if (!parsed.success) {
							error()
							return
						}
						next(parsed.data)
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
	}
}
