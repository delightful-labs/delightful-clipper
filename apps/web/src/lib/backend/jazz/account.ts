import { ReadTier } from 'jazz-tools'
import wasmUrl from '#jazz-wasm-binary?url'
import type { JazzSession, JazzSessionConfig } from 'jazz-tools/svelte'
import type { JazzClient } from 'jazz-tools/client'
import { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'
import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import type { AccountHost, AccountInput, AccountObservation } from '../../contracts/account.js'
import { app } from './schema.js'

type Session = JazzSession<JazzClient>

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
		subscribe: (notify) => {
			const publish = () => notify(read())
			const unsubscribe = readiness.capability.subscribe(publish)
			publish()
			return unsubscribe
		},
		create: () => session.createLocalFirst(),
		logout: () => session.logout(),
		retry: () => session.retry(),
		close: () => {
			recovery.invalidate()
			restored.invalidate()
			return session.close()
		},
		restoration: restored
	}
}

export function accountInput(config: JazzSessionConfig): AccountInput {
	const acquisition = createJazzSessionAcquisition({
		...config,
		runtimeSources: { wasmUrl, wasmVersion: '2.0.0-alpha.59' }
	})
	return { open: async () => bindHost(await acquisition.capability.open()) }
}
