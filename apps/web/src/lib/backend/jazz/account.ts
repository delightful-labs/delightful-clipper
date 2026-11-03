import { createLibraryCapability } from './library.js'
import { createLibraryRecords } from './records.js'
import { ReadTier } from 'jazz-tools'
import wasmUrl from '#jazz-wasm-binary?url'
import type { JazzSession, JazzSessionConfig } from 'jazz-tools/svelte'
import type { JazzClient } from 'jazz-tools/client'
import { createJazzStartupRegistry } from 'delightful-local-first/backend/jazz/startup'
import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import type { AccountHost, AccountInput, AccountObservation } from '../../contracts/account.js'
import { app } from './schema.js'

export type Session = JazzSession<JazzClient>

function bindHost(session: Session): AccountHost {
	const readiness = createJazzSessionReadinessAdapter(session)
	const recovery = createJazzRecoveryAdapter(() => session.getSnapshot().account)
	let current: AccountObservation = { status: 'signed-out' }
	let client: JazzClient | undefined
	const read = (): AccountObservation => {
		const snapshot = session.getSnapshot()
		recovery.observeAccount(snapshot.account)
		if (snapshot.status !== 'ready' || !snapshot.account || !snapshot.client) {
			client = undefined
			current = { status: snapshot.status === 'ready' ? 'error' : snapshot.status }
			return current
		}
		if (client === snapshot.client && current.status === 'ready') return current
		client = snapshot.client
		const account = snapshot.account
		const db = snapshot.client.db
		const check = () => {
			const now = session.getSnapshot()
			if (now.status !== 'ready' || now.account !== account || now.client?.db !== db)
				throw new Error('Account scope expired')
		}
		current = {
			status: 'ready',
			binding: Object.freeze({}),
			accountId: account.id,
			library: createLibraryCapability(
				createLibraryRecords(db, account.id, () => {
					try {
						check()
						return true
					} catch {
						return false
					}
				}),
				account.id,
				requestCapture
			),
			root: {
				read: async () => {
					check()
					const row = await db.one(app.libraries.where({ id: account.id }), {
						tier: ReadTier.LocalFirst
					})
					if (!row) return 'missing'
					return row.ownerId === account.id && row.bootstrapVersion === '1'
						? 'compatible'
						: 'incompatible'
				},
				ensure: () => {
					check()
					const write = db.upsert(app.libraries, account.id, {
						ownerId: account.id,
						bootstrapVersion: '1'
					})
					return {
						local: () => write.wait({ tier: 'local' }),
						global: () => write.wait({ tier: 'global' })
					}
				}
			},
			recovery: {
				capability: recovery.capability,
				source: {
					subscribe: (notify) => {
						const publish = () => notify(recovery.observeAccount(session.getSnapshot().account))
						publish()
						return session.subscribe(publish)
					}
				}
			}
		}
		return current
	}
	const restored = createJazzRestorationAdapter(session, () => session)
	return {
		read,
		readiness,
		create: () => session.createLocalFirst(),
		logout: () => session.logout(),
		release: () => {
			recovery.invalidate()
			restored.invalidate()
		},
		restoration: restored
	}
}

// Constructing the registry is inert; only browser mount requests an attachment.
const registry = createJazzStartupRegistry()
const runtimeSources = Object.freeze({ wasmUrl, wasmVersion: '2.0.0-alpha.59' })
export function accountInput(config: JazzSessionConfig): AccountInput<Session> {
	return { startup: registry.getJazzStartupBinding({ ...config, runtimeSources }), bind: bindHost }
}

/** A consuming integration owns/drains the returned record actors before identity changes. */
export function currentLibraryRecords() {
	const session = registry.getCurrentJazzSession()
	const snapshot = session?.getSnapshot()
	if (!session || snapshot?.status !== 'ready' || !snapshot.account || !snapshot.client)
		throw new Error('Library scope unavailable')
	const { account, client } = snapshot
	return createLibraryRecords(client.db, account.id, () => {
		const now = session.getSnapshot()
		return now.status === 'ready' && now.account === account && now.client === client
	})
}

/** Read the managed bearer immediately before dispatch; results belong to this binding. */
export async function requestCapture(
	operation: 'resolve' | 'extract' | 'asset',
	body: unknown,
	signal?: AbortSignal
) {
	const session = registry.getCurrentJazzSession()
	const snapshot = session?.getSnapshot()
	if (!session || snapshot?.status !== 'ready' || !snapshot.account || !snapshot.client)
		throw new Error('Account scope unavailable')
	const { account, client } = snapshot
	const token = client.db.getConfig().jwtToken
	if (!token) throw new Error('Authentication unavailable')
	const response = await fetch(`/api/capture/${operation}`, {
		method: 'POST',
		credentials: 'omit',
		redirect: 'error',
		cache: 'no-store',
		signal: signal ?? null,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	})
	const now = session.getSnapshot()
	if (now.status !== 'ready' || now.account !== account || now.client !== client) {
		await response.body?.cancel()
		throw new Error('Account scope expired')
	}
	return response
}
