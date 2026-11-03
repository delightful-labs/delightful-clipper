import type {
	Manifest,
	Part,
	PreparedSave,
	SaveRequest,
	TextSnapshot
} from '../contracts/storage.js'
export const TEXT_LIMIT = 64 * 1024
export const BYTE_LIMIT = 1024 * 1024
export const PART_SIZE = 256 * 1024
const encoder = new TextEncoder()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function hash(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
// A bounded codec-resource leaf: always release/cancel the stream reader on failure.
async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	try {
		for (;;) {
			const next = await reader.read()
			if (next.done) break
			size += next.value.byteLength
			if (size > limit) throw new Error('Storage byte limit exceeded')
			chunks.push(next.value)
		}
	} catch (error) {
		await reader.cancel().catch(() => {})
		throw error
	} finally {
		reader.releaseLock()
	}
	const output = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.byteLength
	}
	return output
}
async function partId(operationId: string, ordinal: number) {
	const digest = await hash(encoder.encode(`clipper-blob-part-v1:${operationId}:${ordinal}`))
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}
export async function prepareSave(libraryId: string, request: SaveRequest): Promise<PreparedSave> {
	const { operationId, title, text, mediaType } = request
	if (
		!uuid.test(operationId) ||
		!title.trim() ||
		title.length > 500 ||
		!mediaType ||
		mediaType.length > 150 ||
		encoder.encode(text).byteLength > TEXT_LIMIT ||
		request.bytes.byteLength > BYTE_LIMIT
	)
		throw new Error('Invalid bounded storage request')
	const bytes = new Uint8Array(request.bytes)
	const compressed = await collect(
		new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
		BYTE_LIMIT + PART_SIZE
	)
	const [textHash, assetHash] = await Promise.all([hash(encoder.encode(text)), hash(compressed)])
	const chunks = Array.from({ length: Math.ceil(compressed.length / PART_SIZE) }, (_, ordinal) =>
		compressed.slice(ordinal * PART_SIZE, (ordinal + 1) * PART_SIZE)
	)
	const parts = await Promise.all(
		chunks.map(async (payload, ordinal) => ({
			id: await partId(operationId, ordinal),
			libraryId,
			manifestId: operationId,
			ordinal,
			byteLength: payload.length,
			hash: await hash(payload),
			payload
		}))
	)
	const createdAt = new Date().toISOString()
	const payloadHash = await hash(
		encoder.encode(JSON.stringify([title, textHash, assetHash, mediaType, bytes.length]))
	)
	return {
		intent: { id: operationId, libraryId, payloadHash, createdAt },
		manifest: {
			id: operationId,
			libraryId,
			operationId,
			mediaType,
			encoding: 'gzip-v1',
			byteLength: compressed.length,
			originalByteLength: bytes.length,
			partCount: parts.length,
			hash: assetHash
		},
		parts,
		snapshot: {
			id: operationId,
			libraryId,
			documentId: operationId,
			text,
			hash: textHash,
			formatVersion: '1'
		},
		document: {
			id: operationId,
			libraryId,
			operationId,
			snapshotId: operationId,
			manifestId: operationId,
			title,
			originalSavedAt: createdAt
		}
	}
}
export async function verifyParts(input: {
	manifest: Manifest
	parts: Part[]
}): Promise<Uint8Array> {
	const { manifest } = input
	const parts = [...input.parts].sort((a, b) => a.ordinal - b.ordinal)
	if (
		manifest.encoding !== 'gzip-v1' ||
		!Number.isSafeInteger(manifest.partCount) ||
		manifest.partCount < 1 ||
		manifest.partCount > 5 ||
		manifest.byteLength > BYTE_LIMIT + PART_SIZE ||
		manifest.byteLength < 1 ||
		manifest.originalByteLength > BYTE_LIMIT ||
		manifest.originalByteLength < 0 ||
		parts.length !== manifest.partCount
	)
		throw new Error('Invalid asset manifest')
	const hashes = await Promise.all(parts.map((part) => hash(part.payload)))
	let offset = 0
	const output = new Uint8Array(manifest.byteLength)
	for (const [ordinal, part] of parts.entries()) {
		if (
			part.ordinal !== ordinal ||
			part.manifestId !== manifest.id ||
			part.libraryId !== manifest.libraryId ||
			part.byteLength !== part.payload.length ||
			part.byteLength > PART_SIZE ||
			part.byteLength < 1 ||
			part.hash !== hashes[ordinal] ||
			offset + part.byteLength > output.length
		)
			throw new Error('Asset part mismatch')
		output.set(part.payload, offset)
		offset += part.byteLength
	}
	if (offset !== manifest.byteLength || (await hash(output)) !== manifest.hash)
		throw new Error('Asset digest mismatch')
	return output
}
export async function verifyText(snapshot: TextSnapshot): Promise<boolean> {
	return (
		snapshot.formatVersion === '1' &&
		encoder.encode(snapshot.text).byteLength <= TEXT_LIMIT &&
		(await hash(encoder.encode(snapshot.text))) === snapshot.hash
	)
}
export async function decodeAsset(input: {
	manifest: Manifest
	parts: Part[]
}): Promise<Uint8Array> {
	const compressed = await verifyParts(input)
	const bytes = await collect(
		new Blob([new Uint8Array(compressed)]).stream().pipeThrough(new DecompressionStream('gzip')),
		BYTE_LIMIT
	)
	if (bytes.length !== input.manifest.originalByteLength)
		throw new Error('Asset decoded length mismatch')
	return bytes
}
