import { accountRegistryUrl } from 'jazz-tools'
import { NATIVE_ACCOUNT_STORAGE_PREFIX } from '../../web/src/lib/runtime/worker/storage-channel.js'

/** Match alpha.60's browser AccountStore, including its Web Lock name. The SDK
 * still owns the stored representation and transforms; no identity is migrated. */
export function extensionAccountStorageKey(serverUrl: string) {
	const endpoint = new URL(serverUrl)
	const scope = `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, '')}`
	const registry = accountRegistryUrl(serverUrl, scope)
	return `${NATIVE_ACCOUNT_STORAGE_PREFIX}${encodeURIComponent(registry)}:clipper`
}
