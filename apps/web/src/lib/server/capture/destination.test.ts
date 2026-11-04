import { expect, it } from 'vitest'
import { publicAddress, sourceUrl, resolveDestination } from './destination.js'
it.each([
	'127.0.0.1',
	'0.0.0.0',
	'10.0.0.1',
	'172.16.0.1',
	'192.168.0.1',
	'169.254.169.254',
	'100.64.0.1',
	'192.0.2.1',
	'198.51.100.1',
	'203.0.113.1',
	'224.0.0.1',
	'255.255.255.255',
	'::1',
	'::',
	'fc00::1',
	'fe80::1',
	'::ffff:127.0.0.1',
	'::ffff:8.8.8.8',
	'2001:db8::1',
	'2002:7f00:1::',
	'64:ff9b::7f00:1'
])('blocks prohibited address %s', (address) => expect(publicAddress(address)).toBe(false))
it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public unicast %s', (address) =>
	expect(publicAddress(address)).toBe(true)
)
it.each([
	'file:///etc/passwd',
	'ftp://example.com',
	'http://user:pass@example.com',
	'http://example.com:8080',
	'https://example.com:80'
])('blocks URL %s', (url) => expect(() => sourceUrl(url)).toThrow())
it.each(['http://2130706433', 'http://0x7f000001', 'http://127.1', 'http://[::ffff:127.0.0.1]'])(
	'rejects normalized private URL %s',
	async (url) =>
		await expect(resolveDestination(sourceUrl(url), new AbortController().signal)).rejects.toThrow(
			'redirectBlocked'
		)
)

it('keeps port policy and benign DNS absence explicit', async () => {
	const { usesAllowedPort, isMissingDnsRecord } = await import('./destination.js')
	expect(usesAllowedPort(new URL('https://example.com:443'))).toBe(true)
	expect(usesAllowedPort(new URL('http://example.com:80'))).toBe(true)
	expect(usesAllowedPort(new URL('https://example.com:80'))).toBe(false)
	expect(isMissingDnsRecord(Object.assign(new Error('missing'), { code: 'ENODATA' }))).toBe(true)
	expect(isMissingDnsRecord(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }))).toBe(false)
	expect(isMissingDnsRecord({ code: 'ENOTFOUND' })).toBe(false)
})
