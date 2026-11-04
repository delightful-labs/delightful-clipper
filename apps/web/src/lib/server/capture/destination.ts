import { usesHttpProtocol, hasCredentials } from '../../validation/values.js'
import ipaddr from 'ipaddr.js'
import { isIP } from 'node:net'
import { Resolver } from 'node:dns/promises'
import { CaptureError } from './errors.js'
export function usesAllowedPort(url: URL) {
	if (!url.port) return true
	return url.port === (url.protocol === 'https:' ? '443' : '80')
}
export function isMissingDnsRecord(error: unknown) {
	if (!(error instanceof Error)) return false
	if (!('code' in error)) return false
	return ['ENODATA', 'ENOTFOUND'].includes(String(error.code))
}
export function sourceUrl(value: string): URL {
	if (new TextEncoder().encode(value).length > 8192) throw new CaptureError('invalidInput', 400)
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new CaptureError('invalidInput', 400)
	}
	if (!usesHttpProtocol(url) || hasCredentials(url) || !usesAllowedPort(url))
		throw new CaptureError('redirectBlocked', 400)
	url.hash = ''
	return url
}
export function publicAddress(address: string): boolean {
	if (!isIP(address)) return false
	const parsed = ipaddr.parse(address)
	return (
		parsed.range() === 'unicast' &&
		(parsed.kind() === 'ipv4' || /^2|^3/.test(parsed.toNormalizedString()))
	)
}
export async function resolveDestination(url: URL, signal: AbortSignal) {
	const host = url.hostname.replace(/^\[|\]$/g, '')
	signal.throwIfAborted()
	if (isIP(host)) {
		if (!publicAddress(host)) throw new CaptureError('redirectBlocked', 400)
		return { address: host, family: isIP(host) }
	}
	const resolver = new Resolver({ timeout: 3000, tries: 1 })
	const cancel = () => resolver.cancel()
	signal.addEventListener('abort', cancel, { once: true })
	try {
		signal.throwIfAborted()
		const results = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)])
		signal.throwIfAborted()
		const addresses: string[] = []
		for (const result of results) {
			if (result.status === 'fulfilled') addresses.push(...result.value)
			else if (!isMissingDnsRecord(result.reason))
				throw new CaptureError('sourceUnavailable', 502, true)
		}
		if (!addresses.length) throw new CaptureError('sourceUnavailable', 502, true)
		if (!addresses.every(publicAddress)) throw new CaptureError('redirectBlocked', 400)
		const address = addresses[0]
		if (!address) throw new CaptureError('sourceUnavailable', 502, true)
		return { address, family: isIP(address) }
	} finally {
		signal.removeEventListener('abort', cancel)
	}
}
