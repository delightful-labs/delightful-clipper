import { expect, it } from 'vitest'
import {
	isUuid,
	lowercaseUuidSchema,
	nonblankStringSchema,
	utf8StringSchema,
	usesHttpProtocol,
	hasCredentials
} from './values.js'
it('keeps case-insensitive operation IDs separate from lowercase stored IDs', () => {
	const lower = 'abcdef01-2345-6789-abcd-ef0123456789'
	expect(isUuid(lower.toUpperCase())).toBe(true)
	expect(lowercaseUuidSchema.safeParse(lower.toUpperCase()).success).toBe(false)
	expect(lowercaseUuidSchema.safeParse(lower).success).toBe(true)
	for (const invalid of [undefined, null, 12, '', lower.replaceAll('-', '')])
		expect(isUuid(invalid)).toBe(false)
})
it('distinguishes UTF-8 byte limits from nonblank character limits', () => {
	expect(utf8StringSchema(4).safeParse('🦊').success).toBe(true)
	expect(utf8StringSchema(3).safeParse('🦊').success).toBe(false)
	expect(utf8StringSchema(0).safeParse('').success).toBe(true)
	expect(nonblankStringSchema(3).safeParse(' a ').success).toBe(true)
	expect(nonblankStringSchema(2).safeParse(' a ').success).toBe(false)
	expect(nonblankStringSchema(3).safeParse('   ').success).toBe(false)
	expect(nonblankStringSchema(3).safeParse(undefined).success).toBe(false)
})
it('checks URL protocol and credentials independently', () => {
	expect(usesHttpProtocol(new URL('https://example.com'))).toBe(true)
	expect(usesHttpProtocol(new URL('javascript:alert(1)'))).toBe(false)
	expect(hasCredentials(new URL('https://user:pass@example.com'))).toBe(true)
	expect(hasCredentials(new URL('https://example.com'))).toBe(false)
})
