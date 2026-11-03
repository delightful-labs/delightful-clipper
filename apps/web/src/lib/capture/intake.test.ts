import { expect, it } from 'vitest'
import {
	decodeCompletion,
	decodeIntake,
	decodeObservation,
	encodeObservation,
	OBSERVATION_LIMIT,
	prepareIntake
} from './intake.js'

const libraryId = crypto.randomUUID()
const id = crypto.randomUUID()
const createdAt = '2026-11-03T12:00:00.000Z'
const intake = prepareIntake(
	libraryId,
	id,
	'https://Example.com:443/article?b=2&a=1#note',
	createdAt
)

it('preserves submitted provenance while conservatively normalizing fetch identity', () => {
	expect(intake).toMatchObject({
		submittedUrl: 'https://Example.com:443/article?b=2&a=1#note',
		fetchUrl: 'https://example.com/article?b=2&a=1'
	})
	expect(decodeIntake(intake, libraryId)).toEqual(intake)
	for (const submittedUrl of [
		'javascript:alert(1)',
		'https://user:secret@example.com/',
		' https://example.com/',
		'https://exam\nple.com/',
		'https://example.com/' + 'x'.repeat(8192)
	])
		expect(() => prepareIntake(libraryId, id, submittedUrl, createdAt)).toThrow()
})

it('rejects foreign, malformed, future and inconsistent intake records before use', () => {
	for (const row of [
		{ ...intake, libraryId: crypto.randomUUID() },
		{ ...intake, id: 'not-an-id' },
		{ ...intake, formatVersion: '2' },
		{ ...intake, fetchUrl: 'https://unrelated.example/' },
		{ ...intake, createdAt: '2026-02-30T12:00:00.000Z' },
		{ ...intake, bearer: 'not-allowed' },
		null,
		[],
		'url'
	])
		expect(() => decodeIntake(row, libraryId)).toThrow()
})

it('decodes only bounded typed observation evidence, never payload completion claims', () => {
	const base = {
		id: crypto.randomUUID(),
		libraryId,
		intakeId: id,
		attemptId: crypto.randomUUID(),
		createdAt,
		formatVersion: '1'
	}
	const failure = {
		...base,
		kind: 'failure',
		payload: JSON.stringify({ code: 'sourceUnavailable', retryable: true })
	}
	expect(encodeObservation(decodeObservation(failure, libraryId), libraryId)).toEqual(failure)
	const resolution = {
		...base,
		kind: 'resolution',
		payload: JSON.stringify({
			finalUrl: 'https://example.com/article',
			resolvedAt: createdAt,
			redirects: [
				{ from: 'https://short.example/', to: 'https://example.com/article', status: 302 }
			]
		})
	}
	expect(decodeObservation(resolution, libraryId).kind).toBe('resolution')
	expect(
		decodeObservation(
			{ ...base, kind: 'uncertain', payload: JSON.stringify({ operationId: id }) },
			libraryId
		).kind
	).toBe('uncertain')
	for (const row of [
		{ ...failure, kind: 'completed', payload: JSON.stringify({ documentId: id }) },
		{ ...failure, payload: '{"privateValue":"do-not-echo"' },
		{ ...failure, payload: JSON.stringify({ code: 'unknown', retryable: true }) },
		{ ...failure, payload: JSON.stringify({ code: 'sourceUnavailable', retryable: 'true' }) },
		{
			...failure,
			payload: JSON.stringify({ code: 'sourceUnavailable', retryable: true, bearer: 'forbidden' })
		},
		{ ...failure, payload: 'x'.repeat(OBSERVATION_LIMIT + 1) },
		{ ...failure, payload: '🦊'.repeat(OBSERVATION_LIMIT / 3) },
		{
			...resolution,
			payload: JSON.stringify({
				finalUrl: 'https://example.com/',
				resolvedAt: createdAt,
				redirects: Array.from({ length: 9 }, () => ({
					from: 'https://a.example/',
					to: 'https://b.example/',
					status: 302
				}))
			})
		},
		{
			...resolution,
			payload: JSON.stringify({
				finalUrl: 'https://example.com/',
				resolvedAt: createdAt,
				redirects: [
					{ from: 'https://user:secret@example.com/', to: 'https://b.example/', status: 200 }
				]
			})
		}
	])
		expect(() => decodeObservation(row, libraryId)).toThrow()
	expect(() => decodeObservation(failure, crypto.randomUUID())).toThrow()
	try {
		decodeObservation({ ...failure, payload: '{"privateValue":"do-not-echo"' }, libraryId)
		throw new Error('Expected invalid observation')
	} catch (error) {
		if (!(error instanceof Error)) throw error
		expect(error.message).toBe('Invalid capture record')
	}
})

it('requires explicit same-library completion identity', () => {
	const completion = {
		id,
		libraryId,
		intakeId: id,
		attemptId: crypto.randomUUID(),
		documentId: crypto.randomUUID(),
		createdAt,
		formatVersion: '1'
	}
	expect(decodeCompletion(completion, libraryId)).toEqual(completion)
	expect(() => decodeCompletion({ ...completion, documentId: null }, libraryId)).toThrow()
	expect(() => decodeCompletion(completion, crypto.randomUUID())).toThrow()
})
