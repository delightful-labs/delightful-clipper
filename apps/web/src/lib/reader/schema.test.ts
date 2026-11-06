import { expect, it } from 'vitest'
import {
	defaultPreferences,
	isValidReaderChange,
	projectReaderState,
	readerOperationSchema
} from './schema.js'
const libraryId = crypto.randomUUID(),
	documentId = crypto.randomUUID()
function operation(
	field: string,
	value: unknown,
	parents: string[] = [],
	id = crypto.randomUUID()
) {
	return readerOperationSchema.parse({
		id,
		libraryId,
		documentId: field === 'position' ? documentId : null,
		field,
		value: JSON.stringify(value),
		parents: JSON.stringify(parents)
	})
}
const position = (offset: number, progress: number, interactedAt = '2026-11-05T12:00:00.000Z') => ({
	version: 1,
	offset,
	quote: 'Reading',
	prefix: '',
	suffix: '',
	progress,
	interactedAt
})
it('validates independent preference bounds and representation-scoped positions', () => {
	expect(isValidReaderChange({ documentId: null, field: 'size', value: 33 })).toBe(false)
	expect(isValidReaderChange({ documentId, field: 'size', value: 20 })).toBe(false)
	expect(isValidReaderChange({ documentId: null, field: 'theme', value: 'dark' })).toBe(true)
	expect(isValidReaderChange({ documentId, field: 'position', value: position(10, 0.5) })).toBe(
		true
	)
	expect(isValidReaderChange({ documentId, field: 'position', value: position(-1, 0.5) })).toBe(
		false
	)
	expect(isValidReaderChange({ documentId, field: 'position', value: position(1, 2) })).toBe(false)
})
it('keeps defaults and independent fields while resolving causal changes and concurrent ties deterministically', () => {
	const dark = operation('theme', 'dark'),
		light = operation('theme', 'light', [dark.id])
	const serif = operation('font', 'serif'),
		sans = operation('font', 'sans')
	const rows = [light, dark, serif, sans]
	const expected = serif.id.localeCompare(sans.id) > 0 ? 'serif' : 'sans'
	expect(projectReaderState(rows).preferences).toEqual({
		...defaultPreferences,
		theme: 'light',
		font: expected
	})
	expect(projectReaderState([...rows].reverse()).preferences).toEqual(
		projectReaderState(rows).preferences
	)
})
it('lets last location move back while furthest progress remains, with causal precedence over interaction clocks', () => {
	const first = operation('position', position(50, 0.8)),
		back = operation('position', position(10, 0.2, '2026-11-04T12:00:00.000Z'), [first.id])
	const state = projectReaderState([back, first])
	expect(state.positions[documentId]?.offset).toBe(10)
	expect(state.progress[documentId]).toBe(0.8)
})
it('uses interaction time then operation ID for available concurrent positions and isolates representations', () => {
	const early = operation('position', position(10, 0.2)),
		late = operation('position', position(20, 0.4, '2026-11-05T13:00:00.000Z'))
	const other = readerOperationSchema.parse({
		...operation('position', position(90, 0.9)),
		documentId: crypto.randomUUID(),
		value: JSON.stringify(position(90, 0.9)),
		parents: '[]'
	})
	expect(projectReaderState([late, early, other]).positions[documentId]?.offset).toBe(20)
	expect(projectReaderState([late, early, other]).progress[documentId]).toBe(0.4)
})
