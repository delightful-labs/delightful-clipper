import { expect, it } from 'vitest'
import { articleId, normalizedSource, extractedCandidate } from './source.js'
it('normalizes only syntax and representation fragments, preserving meaningful differences', async () => {
	const library = crypto.randomUUID()
	expect(await articleId(library, 'HTTPS://EXAMPLE.com:443/a?x=1&y=2#first')).toBe(
		await articleId(library, 'https://example.com/a?x=1&y=2#second')
	)
	for (const different of [
		'http://example.com/a?x=1&y=2',
		'https://example.com/a/?x=1&y=2',
		'https://www.example.com/a?x=1&y=2',
		'https://example.com/a?y=2&x=1'
	])
		expect(await articleId(library, different)).not.toBe(
			await articleId(library, 'https://example.com/a?x=1&y=2')
		)
	expect(await articleId(crypto.randomUUID(), 'https://example.com/')).not.toBe(
		await articleId(library, 'https://example.com/')
	)
})
it.each(['javascript:alert(1)', 'https://user:pass@example.com/', 'file:///a'])(
	'rejects unsafe client intake %s',
	(value) => expect(() => normalizedSource(value)).toThrow()
)
it('bounds preview content and retains canonical evidence without changing identity', () => {
	const data = {
		operationId: 'request',
		finalUrl: 'https://example.com/a',
		canonicalCandidate: 'https://unrelated.example/',
		candidate: { title: 'Title', text: 'literal <script>', html: '<p>literal</p>' }
	}
	const result = extractedCandidate(data, 'request', 'https://short.example/')
	expect(result.finalUrl).toBe(data.finalUrl)
	expect(result.provenance).toContain(data.canonicalCandidate)
	expect(() =>
		extractedCandidate({ ...data, operationId: 'stale' }, 'request', 'https://short.example/')
	).toThrow()
	expect(() =>
		extractedCandidate(
			{ ...data, candidate: { ...data.candidate, text: 'x'.repeat(65537) } },
			'request',
			'https://short.example/'
		)
	).toThrow()
})
it('keeps envelope and content failures distinct while retaining extraction evidence', () => {
	const data = {
		operationId: 'request',
		finalUrl: 'https://example.com/',
		candidate: {
			title: ' Title ',
			text: ' exact ',
			html: '<p>exact</p>',
			parserVersion: 'qualified-parser',
			partialEvidence: ['partial'],
			assetCandidates: [{}]
		}
	}
	const result = extractedCandidate(data, 'request', 'https://short.example/')
	expect(result.title).toBe(' Title ')
	expect(result.text).toBe(' exact ')
	expect(result.imagesMissing).toBe(true)
	expect(result.provenance).toContain('qualified-parser')
	expect(() => extractedCandidate({ ...data, candidate: [] }, 'request', data.finalUrl)).toThrow(
		'invalidResponse'
	)
	expect(() =>
		extractedCandidate(
			{ ...data, candidate: { ...data.candidate, title: 42 } },
			'request',
			data.finalUrl
		)
	).toThrow('sourceTooLarge')
})
