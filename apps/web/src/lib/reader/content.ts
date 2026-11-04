import { usesHttpProtocol, hasCredentials } from '../validation/values.js'
import type { AssetResult } from '../contracts/storage.js'
import { BYTE_LIMIT } from '../storage/prepare.js'
import { articlePolicy, articlePurifier } from './policy.js'

/** Treat persisted HTML as untrusted, even when extraction already sanitized it. */
export function savedContent(
	asset: AssetResult,
	document: Document,
	sourceUrl?: string
): DocumentFragment | undefined {
	if (
		asset.kind !== 'available' ||
		asset.mediaType !== 'text/html' ||
		asset.bytes.length > BYTE_LIMIT
	)
		return undefined
	const window = document.defaultView
	if (!window) return undefined
	try {
		const html = new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes)
		// Conservative markup-token bound before DOM parsing; unusual/oversized markup uses text.
		if ((html.match(/</g)?.length ?? 0) > 5000) return undefined
		const purify = articlePurifier(window)
		const fragment = purify.sanitize(html, { ...articlePolicy, RETURN_DOM_FRAGMENT: true })
		if (!fragment.textContent?.trim() || fragment.querySelectorAll('*').length > 5000)
			return undefined
		// IDs are display-only. Never let saved IDs collide with account controls or named globals.
		const namespace = `clipper-reader-${crypto.randomUUID()}-`
		const targets = new Map<string, string>()
		for (const element of fragment.querySelectorAll('[id]')) {
			const original = element.id
			if (!targets.has(original)) {
				const id = `${namespace}${targets.size}`
				targets.set(original, id)
				element.id = id
				element.setAttribute('tabindex', '-1')
			} else element.removeAttribute('id')
		}
		for (const link of fragment.querySelectorAll('a[href]')) {
			const href = link.getAttribute('href') ?? ''
			link.removeAttribute('href')
			if (href.startsWith('#')) {
				let target: string | undefined
				try {
					target = targets.get(decodeURIComponent(href.slice(1)))
				} catch {
					/* Invalid fragment. */
				}
				if (target) link.setAttribute('href', `#${target}`)
			} else {
				try {
					const url = new URL(href, sourceUrl)
					if (!usesHttpProtocol(url) || hasCredentials(url)) continue
					link.setAttribute('href', url.href)
					link.setAttribute('rel', 'noreferrer')
					// Article navigation uses the browser, including modifier keys, rather than app routing.
					link.setAttribute('data-sveltekit-reload', '')
				} catch {
					/* Keep invalid links as readable text. */
				}
			}
		}
		return fragment
	} catch {
		return undefined
	}
}
