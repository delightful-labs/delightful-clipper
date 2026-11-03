import { isArticlePath } from '../reader/routes.js'
import { JAZZ_RUNTIME_VERSION } from './runtime-version.js'
export const SHELL_CACHE_PREFIX = 'delightful-clipper-shell-v1-'
export type ShellPolicy = {
	origin: string
	root: string
	cacheName: string
	paths: Set<string>
	immutable: Set<string>
	runtime: Set<string>
}
export function shellPolicy(
	scope: string,
	version: string,
	immutable: string[],
	assets: string[]
): ShellPolicy {
	const base = new URL(scope)
	const path = (value: string) => {
		const url = new URL(value.replace(/^\//, ''), base)
		if (
			url.origin !== base.origin ||
			!url.pathname.startsWith(base.pathname) ||
			url.search ||
			url.hash
		)
			throw new Error('Invalid public shell asset')
		return url.href
	}
	const immutablePaths = immutable.filter((value) => !value.endsWith('.map')).map(path)
	const paths = new Set([
		base.href,
		...immutablePaths,
		...assets.filter((value) => !value.endsWith('.map')).map(path)
	])
	return {
		origin: base.origin,
		root: base.href,
		cacheName: SHELL_CACHE_PREFIX + version,
		paths,
		immutable: new Set(immutablePaths),
		runtime: new Set(
			immutablePaths.filter((value) =>
				/\/(?:jazz_wasm_bg[^/]*\.wasm|jazz-broker-worker[^/]*\.js)$/.test(value)
			)
		)
	}
}
/** Known article navigations reuse only the public shell, never cached article responses. */
export function shellKey(policy: ShellPolicy, request: Request): string | undefined {
	const url = new URL(request.url)
	if (
		request.method !== 'GET' ||
		url.origin !== policy.origin ||
		request.headers.has('authorization') ||
		request.headers.has('range')
	)
		return undefined
	const scopePath = new URL(policy.root).pathname
	if (
		request.mode === 'navigate' &&
		!url.search &&
		url.pathname.startsWith(scopePath) &&
		isArticlePath('/' + url.pathname.slice(scopePath.length))
	)
		return policy.root
	const original = url.href
	url.search = ''
	url.hash = ''
	if (!policy.paths.has(url.href)) return undefined
	if (original !== url.href) {
		const params = new URL(original).searchParams
		if (
			!policy.runtime.has(url.href) ||
			Array.from(params).length !== 1 ||
			params.get('jazz-runtime-version') !== JAZZ_RUNTIME_VERSION
		)
			return undefined
	}
	return url.href
}
export function publicResponse(response: Response) {
	return (
		response.status === 200 &&
		!response.redirected &&
		response.type !== 'opaque' &&
		!/(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get('cache-control') ?? '')
	)
}
export function obsoleteShellCaches(names: string[], current: string) {
	return names.filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== current)
}

export function publicAssetResponse(path: string, response: Response) {
	if (!publicResponse(response)) return false
	const pathname = new URL(path).pathname,
		type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
	if (pathname.endsWith('.wasm')) return type === 'application/wasm'
	if (pathname.endsWith('.js'))
		return type === 'text/javascript' || type === 'application/javascript'
	if (pathname.endsWith('.css')) return type === 'text/css'
	if (pathname.endsWith('/')) return type === 'text/html'
	return true
}
