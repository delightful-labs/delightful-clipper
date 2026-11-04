import { isValidTitle, isValidExtractedText, isBoundedHtml } from '../storage/policy.js'
import { usesHttpProtocol, hasCredentials, isRecord } from '../validation/values.js'
export function normalizedSource(value: string) {
	if (value.length > 8192) throw new Error('invalidUrl')
	const url = new URL(value)
	if (!usesHttpProtocol(url) || hasCredentials(url)) throw new Error('invalidUrl')
	url.hash = ''
	return url.href
}
/** Same verified destination in the same private library has one immutable identity. */
export async function articleId(libraryId: string, finalUrl: string) {
	const bytes = new Uint8Array(
		await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(
				JSON.stringify(['clipper.article.1', libraryId, normalizedSource(finalUrl)])
			)
		)
	)
	bytes[6] = ((bytes[6] ?? 0) & 15) | 128
	bytes[8] = ((bytes[8] ?? 0) & 63) | 128
	const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export type Candidate = {
	id: string
	title: string
	text: string
	html: string
	finalUrl: string
	submittedUrl: string
	provenance: string
	imagesMissing: boolean
}
function object(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) throw new Error('invalidResponse')
	return value
}
export function resolvedUrl(value: unknown, requestId: string) {
	const data = object(value)
	if (data.operationId !== requestId || typeof data.finalUrl !== 'string')
		throw new Error('invalidResponse')
	return normalizedSource(data.finalUrl)
}
export function extractedCandidate(
	value: unknown,
	requestId: string,
	submittedUrl: string
): Omit<Candidate, 'id'> {
	const data = object(value),
		candidate = object(data.candidate)
	const finalUrl = resolvedUrl(value, requestId)
	if (
		!isValidTitle(candidate.title) ||
		!isValidExtractedText(candidate.text) ||
		!isBoundedHtml(candidate.html)
	)
		throw new Error('sourceTooLarge')
	const provenance = JSON.stringify({
		submittedUrl,
		observation: data.provenance,
		canonicalCandidate: data.canonicalCandidate,
		parserVersion: candidate.parserVersion,
		normalizationVersion: candidate.normalizationVersion,
		partialEvidence: candidate.partialEvidence
	})
	if (provenance.length > 32768) throw new Error('sourceTooLarge')
	return {
		title: candidate.title,
		text: candidate.text,
		html: candidate.html,
		finalUrl,
		submittedUrl,
		provenance,
		imagesMissing: Array.isArray(candidate.assetCandidates) && candidate.assetCandidates.length > 0
	}
}
