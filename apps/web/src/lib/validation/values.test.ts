import { expect, it } from 'vitest'
import {
	isUuid,
	isLowercaseUuid,
	isNonblankString,
	isUtf8WithinLimit,
	usesHttpProtocol,
	hasCredentials
} from './values.js'
it('keeps case-insensitive operation IDs separate from lowercase stored IDs', () => {
	const lower = 'abcdef01-2345-6789-abcd-ef0123456789'
	expect(isUuid(lower.toUpperCase())).toBe(true)
	expect(isLowercaseUuid(lower.toUpperCase())).toBe(false)
	expect(isLowercaseUuid(lower)).toBe(true)
	for (const invalid of [undefined, null, 12, '', lower.replaceAll('-', '')])
		expect(isUuid(invalid)).toBe(false)
})
it('distinguishes UTF-8 byte limits from nonblank character limits', () => {
	expect(isUtf8WithinLimit('🦊', 4)).toBe(true)
	expect(isUtf8WithinLimit('🦊', 3)).toBe(false)
	expect(isUtf8WithinLimit('', 0)).toBe(true)
	expect(isNonblankString(' a ', 3)).toBe(true)
	expect(isNonblankString(' a ', 2)).toBe(false)
	expect(isNonblankString('   ', 3)).toBe(false)
	expect(isNonblankString(undefined, 3)).toBe(false)
})
it('checks URL protocol and credentials independently', () => {
	expect(usesHttpProtocol(new URL('https://example.com'))).toBe(true)
	expect(usesHttpProtocol(new URL('javascript:alert(1)'))).toBe(false)
	expect(hasCredentials(new URL('https://user:pass@example.com'))).toBe(true)
	expect(hasCredentials(new URL('https://example.com'))).toBe(false)
})
