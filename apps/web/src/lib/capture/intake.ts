import { normalizedSource } from './source.js'
import type {
	CaptureCompletion,
	CaptureFailureCode,
	CaptureIntake,
	CaptureObservation,
	ResolutionEvidence
} from '../contracts/intake.js'

const encoder = new TextEncoder()
export const OBSERVATION_LIMIT = 32 * 1024
const failureCodes: ReadonlySet<string> = new Set<CaptureFailureCode>([
	'invalidInput',
	'permissionDenied',
	'sessionUnavailable',
	'gatewayUnavailable',
	'rateLimited',
	'redirectBlocked',
	'redirectLoop',
	'fetchTimeout',
	'sourceUnavailable',
	'parseFailed',
	'sourceTooLarge',
	'unsupportedSource',
	'unsupportedMedia',
	'invalidResponse',
	'networkUnavailable',
	'canceled'
])
function invalid(): never {
	throw new Error('Invalid capture record')
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isFailureCode(value: unknown): value is CaptureFailureCode {
	return typeof value === 'string' && failureCodes.has(value)
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
	if (!isRecord(value)) return invalid()
	const row = value
	if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
		return invalid()
	return row
}
export function captureUuid(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
	)
		return invalid()
	return value
}
function timestamp(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
		!Number.isFinite(Date.parse(value)) ||
		new Date(value).toISOString() !== value
	)
		return invalid()
	return value
}
function url(value: unknown): string {
	if (typeof value !== 'string' || value.length > 8192 || value !== value.trim()) return invalid()
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index)
		if (code < 32 || code === 127) return invalid()
	}
	try {
		normalizedSource(value)
	} catch {
		return invalid()
	}
	return value
}
function version(value: unknown): '1' {
	if (value !== '1') return invalid()
	return value
}
export function decodeIntake(value: unknown, libraryId: string): CaptureIntake {
	const row = object(value, [
		'id',
		'libraryId',
		'submittedUrl',
		'fetchUrl',
		'createdAt',
		'formatVersion'
	])
	if (row.libraryId !== captureUuid(libraryId)) return invalid()
	const submittedUrl = url(row.submittedUrl)
	const fetchUrl = url(row.fetchUrl)
	if (fetchUrl !== normalizedSource(submittedUrl)) return invalid()
	return {
		id: captureUuid(row.id),
		libraryId,
		submittedUrl,
		fetchUrl,
		createdAt: timestamp(row.createdAt),
		formatVersion: version(row.formatVersion)
	}
}
export function prepareIntake(
	libraryId: string,
	id: string,
	submittedUrl: string,
	createdAt: string
): CaptureIntake {
	const submitted = url(submittedUrl)
	return decodeIntake(
		{
			id,
			libraryId,
			submittedUrl: submitted,
			fetchUrl: normalizedSource(submitted),
			createdAt,
			formatVersion: '1'
		},
		libraryId
	)
}
function resolution(value: unknown): ResolutionEvidence {
	const row = object(value, ['finalUrl', 'resolvedAt', 'redirects'])
	if (!Array.isArray(row.redirects) || row.redirects.length > 8) return invalid()
	const redirects = row.redirects.map((value) => {
		const hop = object(value, ['from', 'to', 'status'])
		if (typeof hop.status !== 'number' || ![301, 302, 303, 307, 308].includes(hop.status))
			return invalid()
		return { from: url(hop.from), to: url(hop.to), status: hop.status }
	})
	return { finalUrl: url(row.finalUrl), resolvedAt: timestamp(row.resolvedAt), redirects }
}
/** Persisted JSON is evidence only after bounded, exact-shape decoding. */
export function decodeObservation(value: unknown, libraryId: string): CaptureObservation {
	const row = object(value, [
		'id',
		'libraryId',
		'intakeId',
		'attemptId',
		'createdAt',
		'formatVersion',
		'kind',
		'payload'
	])
	if (
		row.libraryId !== captureUuid(libraryId) ||
		typeof row.payload !== 'string' ||
		row.payload.length > OBSERVATION_LIMIT ||
		encoder.encode(row.payload).length > OBSERVATION_LIMIT
	)
		return invalid()
	const base = {
		id: captureUuid(row.id),
		libraryId,
		intakeId: captureUuid(row.intakeId),
		attemptId: captureUuid(row.attemptId),
		createdAt: timestamp(row.createdAt),
		formatVersion: version(row.formatVersion)
	}
	let payload: unknown
	try {
		payload = JSON.parse(row.payload)
	} catch {
		return invalid()
	}
	if (row.kind === 'resolution')
		return { ...base, kind: 'resolution', payload: resolution(payload) }
	if (row.kind === 'uncertain')
		return {
			...base,
			kind: 'uncertain',
			payload: { operationId: captureUuid(object(payload, ['operationId']).operationId) }
		}
	if (row.kind !== 'failure') return invalid()
	const failure = object(payload, ['code', 'retryable'])
	if (!isFailureCode(failure.code) || typeof failure.retryable !== 'boolean') return invalid()
	return {
		...base,
		kind: 'failure',
		payload: { code: failure.code, retryable: failure.retryable }
	}
}
export function encodeObservation(value: CaptureObservation, libraryId: string) {
	const row = { ...value, payload: JSON.stringify(value.payload) }
	decodeObservation(row, libraryId)
	return row
}
export function decodeCompletion(value: unknown, libraryId: string): CaptureCompletion {
	const row = object(value, [
		'id',
		'libraryId',
		'intakeId',
		'attemptId',
		'documentId',
		'createdAt',
		'formatVersion'
	])
	if (row.libraryId !== captureUuid(libraryId)) return invalid()
	return {
		id: captureUuid(row.id),
		libraryId,
		intakeId: captureUuid(row.intakeId),
		attemptId: captureUuid(row.attemptId),
		documentId: captureUuid(row.documentId),
		createdAt: timestamp(row.createdAt),
		formatVersion: version(row.formatVersion)
	}
}
export function sameIntake(a: CaptureIntake, b: CaptureIntake): boolean {
	return (
		a.id === b.id &&
		a.libraryId === b.libraryId &&
		a.submittedUrl === b.submittedUrl &&
		a.fetchUrl === b.fetchUrl &&
		a.createdAt === b.createdAt &&
		a.formatVersion === b.formatVersion
	)
}
