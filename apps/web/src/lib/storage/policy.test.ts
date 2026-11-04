import { expect, it } from 'vitest'
import {
	BYTE_LIMIT,
	TEXT_LIMIT,
	isBoundedSaveRequest,
	isValidExtractedText,
	isValidTitle,
	isValidMediaType,
	isBoundedHtml,
	isBoundedSourceMetadata
} from './policy.js'
it('preserves inclusive title, media-type, text and HTML bounds', () => {
	expect(isValidTitle('a'.repeat(500))).toBe(true)
	expect(isValidTitle('a'.repeat(501))).toBe(false)
	expect(isValidMediaType('a'.repeat(150))).toBe(true)
	expect(isValidMediaType('a'.repeat(151))).toBe(false)
	expect(isBoundedHtml('')).toBe(true)
	expect(isBoundedHtml('a'.repeat(BYTE_LIMIT))).toBe(true)
	expect(isBoundedHtml('a'.repeat(BYTE_LIMIT + 1))).toBe(false)
})
it('allows empty stored text but requires nonblank extraction text', () => {
	const request = {
		operationId: 'ABCDEF01-2345-6789-ABCD-EF0123456789',
		title: 'Title',
		text: '',
		mediaType: 'text/plain',
		bytes: new Uint8Array()
	}
	expect(isBoundedSaveRequest(request)).toBe(true)
	expect(isValidExtractedText(request.text)).toBe(false)
	expect(isValidExtractedText(' \n ')).toBe(false)
	expect(isBoundedSaveRequest({ ...request, text: 'é'.repeat(TEXT_LIMIT / 2) })).toBe(true)
	expect(isBoundedSaveRequest({ ...request, text: 'é'.repeat(TEXT_LIMIT / 2 + 1) })).toBe(false)
	expect(isBoundedSaveRequest({ ...request, bytes: new Uint8Array(BYTE_LIMIT + 1) })).toBe(false)
})
it('keeps source URL/provenance limits in characters and accepts omitted metadata', () => {
	const source = {
		finalUrl: 'é'.repeat(8192),
		submittedUrl: 'a'.repeat(8192),
		provenance: 'a'.repeat(32768)
	}
	expect(isBoundedSourceMetadata(undefined)).toBe(true)
	expect(isBoundedSourceMetadata(source)).toBe(true)
	expect(isBoundedSourceMetadata({ ...source, finalUrl: source.finalUrl + 'a' })).toBe(false)
	expect(isBoundedSourceMetadata({ ...source, provenance: source.provenance + 'a' })).toBe(false)
})
