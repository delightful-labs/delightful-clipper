import { createJazzSession } from 'jazz-tools'
import { createLibraryRecords } from '../src/lib/backend/jazz/records.js'
import wasmUrl from '#jazz-wasm-binary?url'
import { JAZZ_RUNTIME_VERSION } from '../src/lib/offline/runtime-version.js'
/** Test fixture access only. The production UI never imports this Window client. */
const session = await createJazzSession({
	appId: import.meta.env.PUBLIC_JAZZ_APP_ID,
	serverUrl: import.meta.env.PUBLIC_JAZZ_SERVER_URL,
	env: 'clipper',
	initial: 'local-first',
	runtimeSources: { wasmUrl, wasmVersion: JAZZ_RUNTIME_VERSION }
})
export function currentLibraryRecords() {
	const { account, client } = session.getSnapshot()
	if (!account || !client) throw new Error('Fixture account unavailable')
	return createLibraryRecords(client.db, account.id, () => session.getSnapshot().client === client)
}
export function requestCapture(
	operation: 'resolve' | 'extract' | 'asset',
	body: unknown,
	signal?: AbortSignal
) {
	const token = session.getSnapshot().client?.db.getConfig().jwtToken
	if (!token) throw new Error('Fixture authentication unavailable')
	return fetch(`/api/capture/${operation}`, {
		method: 'POST',
		signal: signal ?? null,
		credentials: 'omit',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	})
}
