import { expect, it } from 'vitest'
import type {
	DocumentHeader,
	StoredAsset,
	TextSnapshot,
	ArticleSource
} from '../contracts/storage.js'
import {
	assetBelongsToDocument,
	sourceBelongsToDocument,
	snapshotBelongsToDocument,
	isValidAsset,
	isValidSnapshot,
	isValidDocument
} from './integrity.js'
const document: DocumentHeader = {
	id: 'article-alias',
	libraryId: 'library',
	operationId: 'operation',
	snapshotId: 'snapshot',
	assetId: 'asset',
	title: 'Title',
	originalSavedAt: '2026-11-04'
}
const asset: StoredAsset = {
	id: 'asset',
	libraryId: 'library',
	operationId: 'operation',
	mediaType: 'text/html',
	payload: new Uint8Array([1])
}
const snapshot: TextSnapshot = {
	id: 'snapshot',
	libraryId: 'library',
	documentId: 'operation',
	text: 'Saved',
	formatVersion: '1'
}
const source: ArticleSource = {
	id: document.id,
	documentId: document.id,
	libraryId: 'library',
	finalUrl: 'https://example.com',
	submittedUrl: 'https://example.com',
	provenance: '{}'
}
it.each(['id', 'libraryId', 'operationId'] as const)('rejects mismatched asset %s', (field) => {
	expect(assetBelongsToDocument({ ...asset, [field]: 'foreign' }, document)).toBe(false)
})
it('keeps snapshot operation identity distinct from the reader article alias', () => {
	expect(snapshotBelongsToDocument(snapshot, document)).toBe(true)
	expect(isValidSnapshot(snapshot, document)).toBe(true)
	expect(isValidSnapshot({ ...snapshot, documentId: document.id }, document)).toBe(false)
	expect(isValidSnapshot({ ...snapshot, formatVersion: '2' }, document)).toBe(false)
	expect(isValidDocument(document, document.id)).toBe(true)
	expect(isValidDocument(document, 'other')).toBe(false)
})
it('validates optional source linkage and asset payload independently of document readability', () => {
	expect(sourceBelongsToDocument(source, document)).toBe(true)
	expect(sourceBelongsToDocument({ ...source, documentId: 'other' }, document)).toBe(false)
	expect(sourceBelongsToDocument({ ...source, libraryId: 'foreign' }, document)).toBe(false)
	expect(isValidAsset(asset, document)).toBe(true)
	expect(isValidAsset({ ...asset, mediaType: ' ' }, document)).toBe(false)
	expect(isValidAsset(undefined, document)).toBe(false)
})
