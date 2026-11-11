import { JAZZ_RUNTIME_VERSION } from '../../offline/runtime-version.js'
import { createLibraryCapability } from './library.js'
import { createLibraryRecords } from './records.js'
import { readConnection } from './read-connection.js'
import { ReadTier } from 'jazz-tools'
import wasmUrl from '#jazz-wasm-binary?url'
import type { JazzSession, JazzClientConfig } from 'jazz-tools/client'
import type { JazzClient } from 'jazz-tools/client'
import { createJazzStartupRegistry } from 'delightful-local-first/backend/jazz/startup'
import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	AccountBinding,
	ReadyAccountObservation
} from '../../contracts/account.js'
import { app } from './schema.js'

export type Session = JazzSession<JazzClient>

export type LibraryFactory = typeof createLibraryCapability
function externallySignedIn(account: { identity: { issuer: string } }) {
	return !['urn:jazz:local-first', 'urn:jazz:anonymous'].includes(account.identity.issuer)
}
function bindHost(
	session: Session,
	libraryFactory: LibraryFactory,
	cacheNamespace: string
): AccountHost {
	const readiness = createJazzSessionReadinessAdapter(session)
	const recovery = createJazzRecoveryAdapter(() => session.getSnapshot().account)
	const identities = new WeakMap<object, object>()
	const candidates = new WeakMap<ReadyAccountObservation, () => AccountBinding>()
	const identity = (resource: object) => {
		let token = identities.get(resource)
		if (!token) {
			token = Object.freeze({})
			identities.set(resource, token)
		}
		return token
	}
	const read = (): AccountObservation => {
		const snapshot = session.getSnapshot()
		recovery.observeAccount(snapshot.account)
		if (snapshot.status !== 'ready' || !snapshot.account || !snapshot.client) {
			return { status: snapshot.status === 'ready' ? 'error' : snapshot.status }
		}
		const account = snapshot.account
		const client = snapshot.client
		const db = client.db
		const check = () => {
			const now = session.getSnapshot()
			if (
				now.status !== 'ready' ||
				now.account !== account ||
				now.client !== client ||
				now.client?.db !== db
			)
				throw new Error('Account scope expired')
		}
		const build = (live: () => boolean): ReadyAccountObservation => {
			const admitted = () => {
				check()
				if (!live()) throw new Error('Account scope expired')
			}
			return {
				status: 'ready',
				localFirst: db.isLocalFirst(),
				binding: identity(account),
				clientBinding: identity(client),
				databaseBinding: identity(db),
				prepare: () => {
					admitted()
					return db.upgradeToLocalFirst(localFirst)
				},
				logout: () => {
					// Native mutation admission stays bound to the selected identity.
					admitted()
					return session.logout()
				},
				logoutStatus: () => {
					const now = session.getSnapshot()
					if (
						now.status === 'signed-out' ||
						(now.status === 'ready' && now.account && !externallySignedIn(now.account))
					)
						return 'signed-out'
					if (now.status !== 'ready' || !now.account || !now.client) return 'unavailable'
					return now.account === account && now.client === client && now.client.db === db && live()
						? 'current'
						: 'replaced'
				},
				accountId: account.id,
				signedIn: externallySignedIn(account),
				root: {
					read: async () => {
						admitted()
						const row = await db.one(app.libraries.where({ id: account.id }), {
							tier: ReadTier.LocalFirst
						})
						if (!row) return 'missing'
						return row.ownerId === account.id && row.bootstrapVersion === '1'
							? 'compatible'
							: 'incompatible'
					},
					ensure: () => {
						admitted()
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
		}
		const observation = build(() => true)
		candidates.set(observation, () => {
			check()
			let released = false
			const live = () => !released
			const adopted = {
				...build(live),
				library: libraryFactory(
					createLibraryRecords(
						db,
						account.id,
						() => {
							try {
								check()
								if (!live()) return false
								return true
							} catch {
								return false
							}
						},
						readConnection(db)
					),
					account.id,
					requestCapture,
					cacheNamespace
				)
			}
			return {
				observation: adopted,
				release: () => {
					released = true
				}
			}
		})
		return observation
	}
	const restored = createJazzRestorationAdapter(session, () => session)
	return {
		read,
		adopt: (observation) => {
			const create = candidates.get(observation)
			if (!create) throw new Error('Account scope unavailable')
			candidates.delete(observation)
			return create()
		},
		readiness,
		create: () => session.createLocalFirst(),
		signOut: async () => {
			const response = await fetch('/api/auth/sign-out', {
				method: 'POST',
				credentials: 'same-origin',
				redirect: 'error',
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			})
			if (!response.ok) throw new Error('Provider sign-out failed')
		},
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
const localFirst = () => import('jazz-tools/local-first')
const runtimeSources = Object.freeze({ wasmUrl, wasmVersion: JAZZ_RUNTIME_VERSION })
export function accountInput(
	config: JazzClientConfig,
	libraryFactory: LibraryFactory = createLibraryCapability
): AccountInput<Session> {
	// Match Finance: provision a local identity silently when no saved identity exists.
	return {
		startup: registry.getJazzStartupBinding({
			...config,
			client: localFirst,
			initial: 'local-first',
			runtimeSources: config.runtimeSources ?? runtimeSources
		}),
		bind: (session) =>
			bindHost(
				session,
				libraryFactory,
				JSON.stringify([config.scope, config.serverUrl, config.env])
			)
	}
}

/** Existing identities/restoration only; extension sign-in must not create an unrelated account. */
export function existingAccountInput(
	config: JazzClientConfig,
	libraryFactory: LibraryFactory = createLibraryCapability
): AccountInput<Session> {
	return {
		startup: registry.getJazzStartupBinding({
			...config,
			client: localFirst,
			runtimeSources: config.runtimeSources ?? runtimeSources
		}),
		bind: (session) =>
			bindHost(
				session,
				libraryFactory,
				JSON.stringify([config.scope, config.serverUrl, config.env])
			)
	}
}

/** A consuming integration owns/drains the returned record actors before identity changes. */
export function currentLibraryRecords() {
	const session = registry.getCurrentJazzSession()
	const snapshot = session?.getSnapshot()
	if (!session || snapshot?.status !== 'ready' || !snapshot.account || !snapshot.client)
		throw new Error('Library scope unavailable')
	const { account, client } = snapshot
	return createLibraryRecords(
		client.db,
		account.id,
		() => {
			const now = session.getSnapshot()
			return now.status === 'ready' && now.account === account && now.client === client
		},
		readConnection(client.db)
	)
}

/** Guests send their native proof; backend users send their same-origin cookie. */
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
	const response = await fetch(`/api/capture/${operation}`, {
		method: 'POST',
		credentials: 'same-origin',
		redirect: 'error',
		cache: 'no-store',
		signal: signal ?? null,
		headers: {
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	})
	const now = session.getSnapshot()
	if (now.status !== 'ready' || now.account !== account || now.client !== client) {
		await response.body?.cancel()
		throw new Error('Account scope expired')
	}
	return response
}
