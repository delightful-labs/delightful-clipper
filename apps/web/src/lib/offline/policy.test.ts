import { expect, it } from 'vitest'
import {
	publicAssetResponse,
	obsoleteShellCaches,
	publicResponse,
	shellKey,
	shellPolicy,
	SHELL_CACHE_PREFIX
} from './policy.js'
const policy = shellPolicy(
	'https://clipper.example/',
	'build-a',
	[
		'/_app/immutable/app.hash.js',
		'/_app/immutable/assets/jazz_wasm_bg.hash.wasm',
		'/_app/immutable/assets/jazz-broker-worker.hash.js'
	],
	['/icon.svg']
)
it('caches only the public shell and listed build assets', () => {
	expect(shellKey(policy, new Request('https://clipper.example/'))).toBe(policy.root)
	expect(shellKey(policy, new Request('https://clipper.example/_app/immutable/app.hash.js'))).toBe(
		'https://clipper.example/_app/immutable/app.hash.js'
	)
	for (const path of [
		'/api/capture/resolve',
		'/api/private',
		'/account',
		'/unknown.js',
		'/?secret=value',
		'/_app/immutable/app.hash.js?secret=value'
	])
		expect(shellKey(policy, new Request('https://clipper.example' + path))).toBeUndefined()
	expect(shellKey(policy, new Request('https://jazz.example/'))).toBeUndefined()
	expect(
		shellKey(policy, new Request(policy.root, { headers: { Authorization: 'Bearer fixture' } }))
	).toBeUndefined()
	expect(
		shellKey(policy, new Request(policy.root, { headers: { Range: 'bytes=0-99' } }))
	).toBeUndefined()
	expect(
		shellKey(policy, new Request(policy.root, { method: 'POST', body: 'private' }))
	).toBeUndefined()
})
it('normalizes only exact Jazz runtime version queries into the one immutable cache entry', () => {
	for (const path of ['jazz_wasm_bg.hash.wasm', 'jazz-broker-worker.hash.js']) {
		const key = 'https://clipper.example/_app/immutable/assets/' + path
		expect(shellKey(policy, new Request(key + '?jazz-runtime-version=2.0.0-alpha.59'))).toBe(key)
		expect(shellKey(policy, new Request(key + '?jazz-runtime-version=wrong'))).toBeUndefined()
		expect(
			shellKey(policy, new Request(key + '?jazz-runtime-version=2.0.0-alpha.59&other=x'))
		).toBeUndefined()
	}
})
it('does not accept private, failed or redirected installation responses', () => {
	expect(publicResponse(new Response('public'))).toBe(true)
	for (const control of ['private', 'public, no-store', 'max-age=1, private="x"'])
		expect(publicResponse(new Response('private', { headers: { 'Cache-Control': control } }))).toBe(
			false
		)
	expect(publicResponse(new Response('failure', { status: 503 }))).toBe(false)
})
it('deletes only obsolete caches in Clipper’s own namespace', () => {
	expect(
		obsoleteShellCaches(
			[policy.cacheName, SHELL_CACHE_PREFIX + 'old', 'dlf-owned-cache', 'other-app-cache'],
			policy.cacheName
		)
	).toEqual([SHELL_CACHE_PREFIX + 'old'])
})

it('rejects HTML fallbacks masquerading as generated runtime assets', () => {
	const html = new Response('<html>Fallback</html>', { headers: { 'Content-Type': 'text/html' } })
	for (const path of ['app.hash.js', 'runtime.hash.wasm', 'style.hash.css'])
		expect(publicAssetResponse('https://clipper.example/' + path, html)).toBe(false)
	expect(
		publicAssetResponse(
			'https://clipper.example/runtime.hash.wasm',
			new Response(new Uint8Array([0, 97, 115, 109]), {
				headers: { 'Content-Type': 'application/wasm' }
			})
		)
	).toBe(true)
})

it('serves only the public shell for exact article document navigations', () => {
	const id = '4f3165d1-76c7-4cf4-980b-1ced7af05686'
	const navigate = (path: string, headers?: HeadersInit) => {
		const request = new Request('https://clipper.example' + path, { headers: headers ?? {} })
		Object.defineProperty(request, 'mode', { value: 'navigate' })
		return request
	}
	expect(shellKey(policy, navigate('/articles/' + id))).toBe(policy.root)
	expect(shellKey(policy, navigate('/articles/' + id + '#footnote'))).toBe(policy.root)
	expect(shellKey(policy, new Request('https://clipper.example/articles/' + id))).toBeUndefined()
	for (const path of [
		'/articles/' + id + '?private=x',
		'/articles/not-an-id',
		'/articles/' + id + '/extra',
		'/api/articles/' + id,
		'/unknown'
	])
		expect(shellKey(policy, navigate(path))).toBeUndefined()
	expect(
		shellKey(policy, navigate('/articles/' + id, { Authorization: 'Bearer fixture' }))
	).toBeUndefined()
	expect(shellKey(policy, navigate('/articles/' + id, { Range: 'bytes=0-10' }))).toBeUndefined()
	expect(Array.from(policy.paths).some((path) => path.includes('/articles/'))).toBe(false)
})
