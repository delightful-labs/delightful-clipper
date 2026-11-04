import { expect, it } from 'vitest'
import { captureRequestSchema } from './capture-input.js'
import { captureErrorSchema } from './capture-response.js'
const request = {
	protocolVersion: 1,
	operationId: 'ABCDEF01-2345-6789-ABCD-EF0123456789',
	url: 'https://example.com/'
}
it('preserves strict HTTP input keys and UUID case without coercion', () => {
	expect(captureRequestSchema.safeParse(request).success).toBe(true)
	for (const value of [
		null,
		[],
		{},
		{ ...request, protocolVersion: '1' },
		{ ...request, url: 12 },
		{ ...request, headers: { Authorization: 'private' } }
	])
		expect(captureRequestSchema.safeParse(value).success).toBe(false)
})
it('accepts only the existing public gateway error codes', () => {
	expect(
		captureErrorSchema.safeParse({ code: 'sourceUnavailable', details: 'opaque' }).success
	).toBe(true)
	expect(captureErrorSchema.safeParse({ code: 'untrusted-server-error' }).success).toBe(false)
	expect(captureErrorSchema.safeParse({ code: 502 }).success).toBe(false)
})
