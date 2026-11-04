import { createJazzSession } from 'jazz-tools/client'
import { legacyApp } from '../src/lib/backend/jazz/legacy-schema.test-support.js'
import wasmUrl from '#jazz-wasm-binary?url'
import { JAZZ_RUNTIME_VERSION } from '../src/lib/offline/runtime-version.js'
// Retain old clients only for the live-upgrade fixture; browser-process closure owns cleanup.
const liveSessions = new Set<Awaited<ReturnType<typeof createJazzSession>>>()
export async function seedLegacy(keepOpen = false) {
	const session = await createJazzSession({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		serverUrl: 'http://127.0.0.1:5181',
		env: 'clipper',
		initial: 'local-first',
		runtimeSources: { wasmUrl, wasmVersion: JAZZ_RUNTIME_VERSION }
	})
	try {
		const { account, client } = session.getSnapshot()
		if (!account || !client) throw new Error('Legacy account unavailable')
		const db = client.db,
			id = account.id,
			documentId = crypto.randomUUID()
		await db
			.upsert(legacyApp.libraries, id, { ownerId: id, bootstrapVersion: '1' })
			.wait({ tier: 'global' })
		const tx = db.beginTransaction()
		tx.insert(
			legacyApp.storageOperations,
			{ libraryId: id, payloadHash: 'legacy', createdAt: '2026-11-01T00:00:00.000Z' },
			{ id: documentId }
		)
		tx.insert(
			legacyApp.assets,
			{
				libraryId: id,
				operationId: documentId,
				mediaType: 'text/html',
				payload: new TextEncoder().encode('<p>Legacy browser content</p>')
			},
			{ id: documentId }
		)
		tx.insert(
			legacyApp.snapshots,
			{ libraryId: id, documentId, text: 'Legacy browser content', formatVersion: '1' },
			{ id: documentId }
		)
		tx.insert(
			legacyApp.documents,
			{
				libraryId: id,
				operationId: documentId,
				snapshotId: documentId,
				assetId: documentId,
				title: 'Legacy browser article',
				originalSavedAt: '2026-11-01T00:00:00.000Z'
			},
			{ id: documentId }
		)
		await tx.commit().wait({ tier: 'global' })
		return { accountId: id, documentId }
	} finally {
		if (keepOpen) liveSessions.add(session)
		else await session.close()
	}
}
export async function sameAccount(accountId: string) {
	const { currentLibraryRecords } = await import('../src/lib/backend/jazz/account.js')
	return currentLibraryRecords().articles.libraryId === accountId
}
