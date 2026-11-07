import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'
import { causalHeads, causalParentsSchema } from '../capture/causal.js'

export const preferenceSchemas = {
	theme: z.enum(['system', 'light', 'dark']),
	font: z.enum(['serif', 'sans']),
	size: z.number().int().min(16).max(32),
	spacing: z.number().min(1.3).max(2),
	width: z.number().int().min(40).max(90)
}
export const preferencesSchema = z.object(preferenceSchemas)
export type ReaderPreferences = z.infer<typeof preferencesSchema>
export const defaultPreferences: ReaderPreferences = {
	theme: 'system',
	font: 'serif',
	size: 20,
	spacing: 1.6,
	width: 65
}
export const positionSchema = z.object({
	version: z.literal(1),
	offset: z.number().int().min(0).max(10_000_000),
	quote: z.string().min(1).max(160),
	prefix: z.string().max(48),
	suffix: z.string().max(48),
	progress: z.number().min(0).max(1),
	interactedAt: z.iso.datetime()
})
export type ReadingPosition = z.infer<typeof positionSchema>
const preferenceChangeSchema = z.object({ documentId: z.null() })
export const readerChangeSchema = z.discriminatedUnion('field', [
	preferenceChangeSchema.extend({ field: z.literal('theme'), value: preferenceSchemas.theme }),
	preferenceChangeSchema.extend({ field: z.literal('font'), value: preferenceSchemas.font }),
	preferenceChangeSchema.extend({ field: z.literal('size'), value: preferenceSchemas.size }),
	preferenceChangeSchema.extend({ field: z.literal('spacing'), value: preferenceSchemas.spacing }),
	preferenceChangeSchema.extend({ field: z.literal('width'), value: preferenceSchemas.width }),
	z.object({ documentId: lowercaseUuidSchema, field: z.literal('position'), value: positionSchema })
])
export type ReaderChange = z.infer<typeof readerChangeSchema>
export function isValidReaderChange(value: unknown): value is ReaderChange {
	return readerChangeSchema.safeParse(value).success
}
const encodedValue = z
	.string()
	.max(4096)
	.transform((value, context): unknown => {
		try {
			return JSON.parse(value)
		} catch {
			context.addIssue({ code: 'custom', message: 'Invalid reading value' })
			return z.NEVER
		}
	})
export const readerOperationSchema = z
	.object({
		id: lowercaseUuidSchema,
		libraryId: lowercaseUuidSchema,
		documentId: lowercaseUuidSchema.nullable(),
		field: z.string(),
		value: encodedValue,
		parents: causalParentsSchema
	})
	.transform((row, context) => {
		const change = readerChangeSchema.safeParse(row)
		if (!change.success) {
			context.addIssue({ code: 'custom', message: 'Invalid reading operation' })
			return z.NEVER
		}
		return { id: row.id, libraryId: row.libraryId, parents: row.parents, ...change.data }
	})
export type ReaderOperation = z.infer<typeof readerOperationSchema>
export const readerHistorySchema = z.array(readerOperationSchema)
export function canQueueReaderChange(
	queue: readonly ReaderChange[],
	change: unknown
): change is ReaderChange {
	return (
		isValidReaderChange(change) &&
		(queue.length < 64 || queue.some((item) => readerChangeKey(item) === readerChangeKey(change)))
	)
}
export function readerChangeKey(change: Pick<ReaderChange, 'documentId' | 'field'>) {
	return `${change.documentId ?? 'library'}:${change.field}`
}
export function sameReaderField(a: ReaderChange, b: ReaderChange) {
	return a.documentId === b.documentId && a.field === b.field
}
export function mergeReadingProgress(
	current: Record<string, number>,
	observed: Record<string, number>
) {
	const progress = { ...current }
	for (const [id, value] of Object.entries(observed))
		progress[id] = Math.max(progress[id] ?? 0, value)
	return progress
}
export function projectReaderState(operations: readonly ReaderOperation[]) {
	const preferences = { ...defaultPreferences }
	for (const field of [
		'theme',
		'font',
		'size',
		'spacing',
		'width'
	] satisfies (keyof ReaderPreferences)[]) {
		const value = causalHeads(
			operations.filter((row) => row.documentId === null && row.field === field)
		).at(-1)?.value
		if (value !== undefined) Object.assign(preferences, { [field]: value })
	}
	const grouped = new Map<string, Extract<ReaderOperation, { field: 'position' }>[]>()
	for (const row of operations) {
		if (row.field !== 'position' || !row.documentId) continue
		const rows = grouped.get(row.documentId) ?? []
		rows.push(row)
		grouped.set(row.documentId, rows)
	}
	const positions: Record<string, ReadingPosition> = {},
		progress: Record<string, number> = {}
	for (const [id, rows] of grouped) {
		const heads = causalHeads(rows).sort(
			(a, b) => a.value.interactedAt.localeCompare(b.value.interactedAt) || a.id.localeCompare(b.id)
		)
		const position = heads.at(-1)?.value
		if (position) positions[id] = position
		progress[id] = rows.reduce((maximum, row) => Math.max(maximum, row.value.progress), 0)
	}
	return { preferences, positions, progress }
}
