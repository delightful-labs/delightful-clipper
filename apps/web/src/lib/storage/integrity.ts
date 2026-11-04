import type {
	ArticleSource,
	DocumentHeader,
	StoredAsset,
	TextSnapshot
} from '../contracts/storage.js'
import { BYTE_LIMIT, isBoundedText, isValidMediaType, isValidTitle } from './policy.js'
export function assetBelongsToDocument(asset: StoredAsset, document: DocumentHeader) {
	return (
		asset.id === document.assetId &&
		asset.libraryId === document.libraryId &&
		asset.operationId === document.operationId
	)
}
export function sourceBelongsToDocument(source: ArticleSource, document: DocumentHeader) {
	return (
		source.id === document.id &&
		source.documentId === document.id &&
		source.libraryId === document.libraryId
	)
}
/** Reader document IDs may be article aliases; snapshots retain the immutable operation identity. */
export function snapshotBelongsToDocument(snapshot: TextSnapshot, document: DocumentHeader) {
	return (
		snapshot.id === document.snapshotId &&
		snapshot.libraryId === document.libraryId &&
		snapshot.documentId === document.operationId
	)
}
export function isValidDocument(document: DocumentHeader | null, id: string) {
	return document !== null && document.id === id && isValidTitle(document.title)
}
export function isValidSnapshot(snapshot: TextSnapshot | null, document: DocumentHeader) {
	if (!snapshot) return false
	if (snapshot.formatVersion !== '1') return false
	return snapshotBelongsToDocument(snapshot, document) && isBoundedText(snapshot.text)
}
export function isValidAsset(
	asset: StoredAsset | undefined,
	document: DocumentHeader
): asset is StoredAsset {
	if (!asset) return false
	if (!assetBelongsToDocument(asset, document)) return false
	return asset.payload.byteLength <= BYTE_LIMIT && isValidMediaType(asset.mediaType)
}
export function isValidSource(
	source: ArticleSource | undefined,
	document: DocumentHeader
): source is ArticleSource {
	return source !== undefined && sourceBelongsToDocument(source, document)
}
