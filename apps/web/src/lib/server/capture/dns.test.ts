import { afterEach, expect, it, vi } from 'vitest'
const dns = vi.hoisted(() => ({
	resolve4: vi.fn<() => Promise<string[]>>(),
	resolve6: vi.fn<() => Promise<string[]>>(),
	cancel: vi.fn()
}))
vi.mock('node:dns/promises', () => ({
	Resolver: class {
		resolve4 = dns.resolve4
		resolve6 = dns.resolve6
		cancel = dns.cancel
	}
}))
import { resolveDestination } from './destination.js'
afterEach(() => vi.resetAllMocks())
it('rejects mixed public/private DNS answers instead of picking just a public address', async () => {
	dns.resolve4.mockResolvedValue(['8.8.8.8', '10.0.0.1'])
	dns.resolve6.mockResolvedValue([])
	await expect(
		resolveDestination(new URL('https://example.com'), new AbortController().signal)
	).rejects.toThrow('redirectBlocked')
})
it('rejects a private IPv6 answer even when IPv4 is public', async () => {
	dns.resolve4.mockResolvedValue(['8.8.8.8'])
	dns.resolve6.mockResolvedValue(['::1'])
	await expect(
		resolveDestination(new URL('https://example.com'), new AbortController().signal)
	).rejects.toThrow('redirectBlocked')
})
it('cancels pending DNS work on request abort', async () => {
	const controller = new AbortController()
	dns.resolve4.mockImplementation(async () => {
		controller.abort()
		throw new Error('DNS canceled')
	})
	dns.resolve6.mockResolvedValue([])
	await expect(
		resolveDestination(new URL('https://example.com'), controller.signal)
	).rejects.toThrow()
	expect(dns.cancel).toHaveBeenCalledOnce()
})
