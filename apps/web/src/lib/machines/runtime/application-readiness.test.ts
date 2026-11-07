import { observeBrowserConnection } from '../../offline/browser.js'
import type { ConnectionEvent } from '../../contracts/connection.js'
import { controlledSave, testLibraryCapability } from '../capture/library.test-support.js'
import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
import { createActor, fromCallback, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import {
	createApplicationReadinessMachine,
	selectApplicationView
} from './application-readiness.js'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	RootAccess
} from '../../contracts/account.js'

const applicationReadinessMachine = createApplicationReadinessMachine<AccountHost>()
function startup(open: () => Promise<AccountHost>) {
	const binding = {}
	const owner = createActor(createSessionAcquisitionMachine<AccountHost>(), {
		input: { binding, capability: { open } }
	}).start()
	const attach = (): AccountInput<AccountHost> => ({
		startup: { owner, scope: { binding, attachment: {}, generation: 0 } },
		bind: (host) => host
	})
	return { owner, attach }
}
function input(host: AccountHost) {
	return startup(async () => host).attach()
}

function fixture(initial: AccountObservation) {
	let observation = initial
	const listeners = new Set<() => void>()
	const binding = {}
	const host: AccountHost = {
		read: () => observation,
		readiness: {
			binding: {},
			capability: {
				readStatus: () => observation.status,
				subscribe: (notify) => {
					listeners.add(notify)
					return () => {
						listeners.delete(notify)
					}
				},
				retry: vi.fn(async () => {})
			}
		},
		create: vi.fn(async () => {}),
		logout: vi.fn(async () => {}),
		release: vi.fn(() => {}),
		restoration: {
			binding,
			capability: {
				parsePhrase: async () => {
					throw new Error('Invalid synthetic phrase')
				},
				isCurrentBinding: (candidate) => candidate === binding,
				restoreIdentity: vi.fn(async () => {}),
				readIdentity: async () => ({ kind: 'unavailable' })
			}
		}
	}
	return {
		host,
		emit(value: AccountObservation) {
			observation = value
			for (const notify of listeners) notify()
		}
	}
}
function ready(
	accountId: string,
	root: RootAccess
): Extract<AccountObservation, { status: 'ready' }> {
	return {
		status: 'ready',
		binding: {},
		accountId,
		root,
		recovery: {
			source: {
				subscribe: (notify) => {
					notify({ kind: 'unavailable' })
					return () => {}
				}
			},
			capability: { isCurrentScope: () => false, readPhrase: async () => '' }
		}
	}
}
function root(local: Promise<void>, global: Promise<void>) {
	const localWait = vi.fn(() => local)
	return {
		read: async () => 'compatible',
		ensure: () => ({ local: localWait, global: () => global }),
		localWait
	} satisfies RootAccess & { localWait: typeof localWait }
}

describe('account/root ownership', () => {
	it('reuses DLF-owned late acquisition after releasing the first attachment', async () => {
		const opening = Promise.withResolvers<AccountHost>()
		const { host } = fixture({ status: 'signed-out' })
		const open = vi.fn(() => opening.promise)
		const { owner, attach } = startup(open)
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		opening.resolve(host)
		await waitFor(owner, (snapshot) => selectAcquiredSession(snapshot) === host)
		expect(host.release).not.toHaveBeenCalled()
		const next = createActor(applicationReadinessMachine, { input: attach() }).start()
		await waitFor(next, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		expect(open).toHaveBeenCalledOnce()
		next.send({ type: 'SHUTDOWN' })
		await waitFor(next, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
		expect(next.getSnapshot().context.host).toBeUndefined()
		owner.stop()
	})
	it('does not call a locally pending root saved or synced', async () => {
		const local = Promise.withResolvers<void>(),
			global = Promise.withResolvers<void>()
		const access = root(local.promise, global.promise)
		const { host } = fixture(ready('owner', access))
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
		expect(
			actor.getSnapshot().matches({ active: { flow: { running: { library: 'ready' } } } })
		).toBe(false)
		expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('openingLibrary')
		expect(selectApplicationView(actor.getSnapshot(), true).message.text).toBe(
			'Preparing your private library…'
		)
		local.resolve()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: { library: { ready: 'syncPending' } } } } })
		)
		expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('localSaved')
		expect(selectApplicationView(actor.getSnapshot(), true).message.text).toBe(
			'Library saved on this device. Sync pending.'
		)
		global.reject(new Error('Authority rejected'))
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: { library: { ready: 'syncFailed' } } } } })
		)
		expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('syncFailed')
		expect(selectApplicationView(actor.getSnapshot(), true).message.text).toBe(
			'Library saved on this device, but sync failed. Retry when connected.'
		)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('drains a pending root write before releasing the DLF attachment', async () => {
		const local = Promise.withResolvers<void>()
		const access = root(local.promise, Promise.resolve())
		const { host } = fixture(ready('owner', access))
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
		actor.send({ type: 'SHUTDOWN' })
		expect(host.release).not.toHaveBeenCalled()
		local.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
	})
	it('does not publish an old binding after account replacement', async () => {
		const first = Promise.withResolvers<void>()
		const access = root(first.promise, Promise.resolve())
		const initial = ready('first', access)
		const next = ready('second', root(Promise.resolve(), Promise.resolve()))
		const { host, emit } = fixture(initial)
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
		emit(next)
		expect(actor.getSnapshot().context.observation).toBe(next)
		expect(
			actor.getSnapshot().matches({ active: { flow: { running: { library: 'ready' } } } })
		).toBe(false)
		first.resolve()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: { library: { ready: 'synced' } } } } })
		)
		first.resolve()
		await Promise.resolve()
		expect(actor.getSnapshot().context.observation).toBe(next)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('does not overwrite an incompatible root', async () => {
		const ensure = vi.fn(() => ({ local: async () => {}, global: async () => {} }))
		const { host } = fixture(ready('owner', { read: async () => 'incompatible', ensure }))
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: { library: 'conflict' } } } })
		)
		expect(ensure).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('uses DLF validation and clears an invalid restoration phrase without mutation', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		actor.send({ type: 'RESTORE', phrase: 'invalid synthetic phrase' })
		await waitFor(
			actor,
			(snapshot) => selectApplicationView(snapshot, true).feedback === 'restoreInvalid'
		)
		expect(actor.getSnapshot().context.phrase).toBe('')
		expect(actor.getSnapshot().matches({ active: { feedback: 'restoreInvalid' } })).toBe(true)
		expect(selectApplicationView(actor.getSnapshot(), true).feedbackMessage).toEqual({
			text: 'That recovery phrase is invalid. Check it and try again.',
			variant: 'error'
		})
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('retries failed acquisition through the same DLF owner', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const open = vi
			.fn(async () => host)
			.mockRejectedValueOnce(new Error('Synthetic acquisition failure'))
		const { owner, attach } = startup(open)
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ active: { flow: 'openFailed' } }))
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		expect(open).toHaveBeenCalledTimes(2)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		owner.stop()
	})
	it('lets DLF drain an issued SDK retry before releasing the attachment', async () => {
		const pending = Promise.withResolvers<void>()
		const { host } = fixture({ status: 'error' })
		const retry = vi.fn(() => pending.promise)
		const bound = {
			...host,
			readiness: { ...host.readiness, capability: { ...host.readiness.capability, retry } }
		}
		const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'unavailable' } } })
		)
		actor.send({ type: 'RETRY' })
		actor.send({ type: 'RETRY' })
		actor.send({ type: 'SHUTDOWN' })
		expect(retry).toHaveBeenCalledOnce()
		expect(host.release).not.toHaveBeenCalled()
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
		pending.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
	})
	it('reobserves subscription failure through DLF without retrying the SDK', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const subscribe = vi.fn(host.readiness.capability.subscribe).mockImplementationOnce(() => {
			throw new Error('Synthetic observer failure')
		})
		const bound = {
			...host,
			readiness: { ...host.readiness, capability: { ...host.readiness.capability, subscribe } }
		}
		const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'unavailable' } } })
		)
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		expect(subscribe).toHaveBeenCalledTimes(2)
		expect(host.readiness.capability.retry).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it.each(['create', 'logout', 'restore'])(
		'drains %s after acquisition-owner failure and requires reload',
		async (operation) => {
			const pending = Promise.withResolvers<void>()
			const access = root(Promise.resolve(), Promise.resolve())
			const { host } = fixture(
				operation === 'logout' ? ready('owner', access) : { status: 'signed-out' }
			)
			const mutate = vi.fn(() => pending.promise)
			const bound = {
				...host,
				create: mutate,
				logout: mutate,
				restoration: {
					...host.restoration,
					capability: {
						...host.restoration.capability,
						parsePhrase: async () => 'synthetic credential',
						restoreIdentity: mutate
					}
				}
			}
			const { owner, attach } = startup(async () => bound)
			const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
			await waitFor(actor, (snapshot) =>
				operation === 'logout'
					? snapshot.matches({ active: { flow: { running: { library: { ready: 'synced' } } } } })
					: snapshot.matches({ active: { flow: { running: 'signedOut' } } })
			)
			actor.send(
				operation === 'create'
					? { type: 'CREATE' }
					: operation === 'logout'
						? { type: 'LOGOUT' }
						: { type: 'RESTORE', phrase: 'synthetic phrase' }
			)
			await vi.waitFor(() => expect(mutate).toHaveBeenCalledOnce())
			owner.stop()
			expect(host.release).not.toHaveBeenCalled()
			expect(actor.getSnapshot().status).toBe('active')
			expect(actor.getSnapshot().can({ type: 'RETRY' })).toBe(false)
			pending.resolve()
			await waitFor(actor, (snapshot) => snapshot.status === 'done')
			expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
				status: 'ownerFailed',
				canRetry: false,
				requiresReload: true
			})
			expect(host.release).toHaveBeenCalledOnce()
			expect(actor.getSnapshot().context.host).toBeUndefined()
		}
	)
	it('does not offer acquisition retry after its owner has stopped', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const { owner, attach } = startup(async () => host)
		owner.stop()
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
			status: 'ownerFailed',
			canRetry: false,
			requiresReload: true
		})
	})
	it('reports observer cleanup uncertainty instead of successful closure', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const bound = {
			...host,
			readiness: {
				...host.readiness,
				capability: {
					...host.readiness.capability,
					subscribe: () => () => {
						throw new Error('Synthetic cleanup failure')
					}
				}
			}
		}
		const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
			status: 'cleanupFailed',
			requiresReload: true
		})
		expect(host.release).toHaveBeenCalledOnce()
		expect(actor.getSnapshot().context.host).toBeUndefined()
	})
	it('retains a pending root receipt when its acquisition owner fails', async () => {
		const pending = Promise.withResolvers<void>()
		const access = root(pending.promise, Promise.resolve())
		const { host } = fixture(ready('owner', access))
		const { owner, attach } = startup(async () => host)
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
		owner.stop()
		expect(host.release).not.toHaveBeenCalled()
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
		pending.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('ownerFailed')
	})
})

it.each([
	'logout',
	'shutdown',
	'replacement',
	'restore',
	'logout-then-shutdown',
	'restore-then-shutdown'
] as const)('drains library writes before %s releases its account binding', async (mode) => {
	const pending = Promise.withResolvers<import('../../contracts/storage.js').SaveResult>()
	const base = ready('owner', root(Promise.resolve(), Promise.resolve()))
	if (base.status !== 'ready') throw new Error('Expected ready')
	const id = crypto.randomUUID()
	const shutdown = vi.fn()
	const save = controlledSave(() => pending.promise, shutdown)
	const library = testLibraryCapability(
		{
			id,
			title: 'Private',
			text: 'private text',
			html: '<p>private text</p>',
			finalUrl: 'https://example.com/',
			submittedUrl: 'https://example.com/',
			provenance: '{}',
			imagesMissing: false
		},
		{ spawnSave: (spawn, input) => spawn(save, { input }) }
	)
	const observation = { ...base, library }
	const { host, emit } = fixture(observation)
	const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
	const { selectLibraryActor } = await import('./application-readiness.js')
	const product = selectLibraryActor(actor.getSnapshot())
	if (!product) throw new Error('Missing library owner')
	product.send({ type: 'ADD', url: 'https://example.com/' })
	await waitFor(product, (s) => s.matches({ running: { capture: 'saving' } }))
	if (mode === 'logout-then-shutdown' || mode === 'restore-then-shutdown') {
		actor.send(
			mode === 'logout-then-shutdown'
				? { type: 'LOGOUT' }
				: { type: 'RESTORE', phrase: 'invalid synthetic phrase' }
		)
		actor.send({ type: 'SHUTDOWN' })
	} else if (mode === 'replacement')
		emit(ready('other', root(Promise.resolve(), Promise.resolve())))
	else if (mode === 'restore') actor.send({ type: 'RESTORE', phrase: 'invalid synthetic phrase' })
	else actor.send({ type: mode === 'logout' ? 'LOGOUT' : 'SHUTDOWN' })
	await waitFor(actor, (s) =>
		s.matches({ active: { flow: { running: { library: { ready: 'stopping' } } } } })
	)
	expect(shutdown).toHaveBeenCalledOnce()
	expect(selectLibraryActor(actor.getSnapshot())).toBeUndefined()
	expect(host.logout).not.toHaveBeenCalled()
	expect(host.release).not.toHaveBeenCalled()
	expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
	pending.resolve({ kind: 'unknown', operationId: id })
	if (mode === 'shutdown' || mode.endsWith('-then-shutdown'))
		await waitFor(actor, (s) => s.status === 'done')
	else if (mode === 'restore')
		await waitFor(actor, (s) => selectApplicationView(s, true).feedback === 'restoreInvalid')
	else if (mode === 'logout')
		await waitFor(actor, () => vi.mocked(host.logout).mock.calls.length === 1)
	else
		await waitFor(
			actor,
			(s) =>
				s.context.observation.status === 'ready' &&
				s.context.observation.accountId === 'other' &&
				!s.matches({ active: { flow: { running: { library: { ready: 'stopping' } } } } })
		)
	if (mode.endsWith('-then-shutdown')) {
		expect(host.logout).not.toHaveBeenCalled()
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
	}
	expect(product.getSnapshot().status).toBe('done')
	expect(product.getSnapshot().context.url).toBe('')
	actor.send({ type: 'SHUTDOWN' })
})

it.each([false, true])(
	'shows sign-out only for an explicitly signed-in identity (%s)',
	async (signedIn) => {
		const base = ready('owner', root(Promise.resolve(), Promise.resolve()))
		if (base.status !== 'ready') throw new Error('Expected ready')
		const { host } = fixture({ ...base, signedIn })
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
		expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
			canLogout: signedIn,
			canRestore: true
		})
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (s) => s.status === 'done')
	}
)

it('preserves observer cleanup failure precedence when its acquisition owner also fails', async () => {
	const { host } = fixture({ status: 'signed-out' })
	const bound = {
		...host,
		readiness: {
			...host.readiness,
			capability: {
				...host.readiness.capability,
				subscribe: () => () => {
					throw new Error('cleanup failed')
				}
			}
		}
	}
	const { owner, attach } = startup(async () => bound)
	const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'signedOut' } } }))
	owner.stop()
	await waitFor(actor, (s) => s.status === 'done')
	expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
		status: 'cleanupFailed',
		requiresReload: true
	})
	expect(host.release).toHaveBeenCalledOnce()
})

describe('application-owned browser connectivity', () => {
	it('tracks connectivity in the main snapshot across account observations and releases its observer on shutdown', async () => {
		let report: (event: ConnectionEvent) => void = () => {}
		const dispose = vi.fn()
		const observe = vi.fn((next: typeof report) => {
			report = next
			next({ type: 'OFFLINE' })
			return dispose
		})
		const f = fixture({ status: 'signed-out' })
		const { owner, attach } = startup(async () => f.host)
		const actor = createActor(createApplicationReadinessMachine<AccountHost>(observe), {
			input: attach()
		}).start()
		try {
			await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'signedOut' } } }))
			expect(
				actor.getSnapshot().matches({ active: { connection: { observing: 'offline' } } })
			).toBe(true)
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage).toEqual({
				text: 'offline',
				variant: 'info'
			})
			expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('signedOut')
			report({ type: 'ONLINE' })
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage?.text).toBe(
				'online'
			)
			f.emit({ status: 'transitioning' })
			await waitFor(actor, (s) => s.context.observation.status === 'transitioning')
			expect(observe).toHaveBeenCalledOnce()
			expect(dispose).not.toHaveBeenCalled()
			expect(actor.getSnapshot().matches({ active: { connection: { observing: 'online' } } })).toBe(
				true
			)
			actor.send({ type: 'SHUTDOWN' })
			await waitFor(actor, (s) => s.status === 'done')
			expect(dispose).toHaveBeenCalledOnce()
			report({ type: 'OFFLINE' })
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage).toBeUndefined()
		} finally {
			actor.stop()
			owner.stop()
		}
	})

	it('releases connectivity immediately while an issued root write continues draining', async () => {
		const dispose = vi.fn()
		const pending = Promise.withResolvers<void>()
		const access = root(pending.promise, Promise.resolve())
		const f = fixture(ready('owner', access))
		const { owner, attach } = startup(async () => f.host)
		const actor = createActor(
			createApplicationReadinessMachine<AccountHost>((report) => {
				report({ type: 'ONLINE' })
				return dispose
			}),
			{ input: attach() }
		).start()
		try {
			await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
			actor.send({ type: 'SHUTDOWN' })
			expect(dispose).toHaveBeenCalledOnce()
			expect(actor.getSnapshot().matches({ active: { connection: 'closed' } })).toBe(true)
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage).toBeUndefined()
			expect(f.host.release).not.toHaveBeenCalled()
			pending.resolve()
			await waitFor(actor, (s) => s.status === 'done')
			expect(f.host.release).toHaveBeenCalledOnce()
			expect(dispose).toHaveBeenCalledOnce()
		} finally {
			pending.resolve()
			actor.stop()
			owner.stop()
		}
	})

	it('owns the actual browser listeners and removes them on direct application stop', async () => {
		const target = new EventTarget()
		const browser = { onLine: false }
		const add = vi.spyOn(target, 'addEventListener')
		const remove = vi.spyOn(target, 'removeEventListener')
		vi.stubGlobal('window', target)
		vi.stubGlobal('navigator', browser)
		const f = fixture({ status: 'signed-out' })
		const { owner, attach } = startup(async () => f.host)
		const actor = createActor(
			createApplicationReadinessMachine<AccountHost>(observeBrowserConnection),
			{ input: attach() }
		).start()
		try {
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage?.text).toBe(
				'offline'
			)
			browser.onLine = true
			target.dispatchEvent(new Event('online'))
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage?.text).toBe(
				'online'
			)
			browser.onLine = false
			target.dispatchEvent(new Event('offline'))
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage?.text).toBe(
				'offline'
			)
			expect(add.mock.calls.map((call) => call[0])).toEqual(['online', 'offline'])
			actor.stop()
			expect(remove.mock.calls.map((call) => call[0])).toEqual(['online', 'offline'])
		} finally {
			actor.stop()
			owner.stop()
			vi.unstubAllGlobals()
		}
	})
})

it('drains active capture before connecting and retains an issued connection through shutdown', async () => {
	const saveResult = Promise.withResolvers<import('../../contracts/storage.js').SaveResult>()
	const connection = Promise.withResolvers<void>()
	const shutdown = vi.fn()
	const save = controlledSave(() => saveResult.promise, shutdown)
	const base = ready('owner', root(Promise.resolve(), Promise.resolve()))
	if (base.status !== 'ready') throw new Error('Expected ready')
	const id = crypto.randomUUID()
	const library = testLibraryCapability(
		{
			id,
			title: 'Private',
			text: '',
			html: '',
			finalUrl: 'https://example.com/',
			submittedUrl: 'https://example.com/',
			provenance: '{}',
			imagesMissing: false
		},
		{ spawnSave: (spawn, input) => spawn(save, { input }) }
	)
	const f = fixture({ ...base, library })
	const connect = vi.fn(() => connection.promise)
	const bound: AccountHost = {
		...f.host,
		tokenIdentity: {
			binding: {},
			canSignInExisting: async () => true,
			capability: {
				isCurrentBinding: () => true,
				connectCurrentLibrary: connect,
				signInExistingLibrary: vi.fn(async () => {})
			}
		}
	}
	const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
	const { selectLibraryActor } = await import('./application-readiness.js')
	const product = selectLibraryActor(actor.getSnapshot())!
	product.send({ type: 'ADD', url: 'https://example.com/' })
	await waitFor(product, (s) => s.matches({ running: { capture: 'saving' } }))
	actor.send({
		type: 'CONNECT_TOKEN',
		attemptId: crypto.randomUUID(),
		accountId: 'owner',
		source: { getToken: async () => 'private-token' }
	})
	await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce())
	expect(connect).not.toHaveBeenCalled()
	saveResult.resolve({ kind: 'unknown', operationId: id })
	await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	expect(bound.release).not.toHaveBeenCalled()
	connection.resolve()
	await waitFor(actor, (s) => s.status === 'done')
	expect(bound.release).toHaveBeenCalledOnce()
})
it('refuses existing-library sign-in when local work is present', async () => {
	const base = ready('owner', root(Promise.resolve(), Promise.resolve()))
	const f = fixture(base)
	const signIn = vi.fn(async () => {})
	const bound: AccountHost = {
		...f.host,
		tokenIdentity: {
			binding: {},
			canSignInExisting: async () => false,
			capability: {
				isCurrentBinding: () => true,
				connectCurrentLibrary: vi.fn(async () => {}),
				signInExistingLibrary: signIn
			}
		}
	}
	const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
	actor.send({
		type: 'SIGN_IN_TOKEN',
		attemptId: crypto.randomUUID(),
		accountId: 'owner',
		source: { getToken: async () => 'private-token' }
	})
	await waitFor(actor, (s) => selectApplicationView(s, true).feedback === 'identityFailed')
	expect(signIn).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	await waitFor(actor, (s) => s.status === 'done')
})

it('does not resume OAuth until the library actor can admit a token operation', async () => {
	const reading = Promise.withResolvers<'compatible'>()
	const access: RootAccess = {
		read: () => reading.promise,
		ensure: () => ({ local: async () => {}, global: async () => {} })
	}
	const f = fixture(ready('owner', access))
	const bound: AccountHost = {
		...f.host,
		tokenIdentity: {
			binding: {},
			canSignInExisting: async () => true,
			capability: {
				isCurrentBinding: () => true,
				connectCurrentLibrary: vi.fn(async () => {}),
				signInExistingLibrary: vi.fn(async () => {})
			}
		}
	}
	const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
	try {
		await waitFor(actor, (s) => s.context.observation.status === 'ready')
		expect(selectApplicationView(actor.getSnapshot(), true).canTokenIdentity).toBe(false)
		reading.resolve('compatible')
		await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
		expect(selectApplicationView(actor.getSnapshot(), true).canTokenIdentity).toBe(true)
	} finally {
		reading.resolve('compatible')
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (s) => s.status === 'done')
	}
})

it('refuses connection when the current library is already signed in', async () => {
	const observation = ready('owner', root(Promise.resolve(), Promise.resolve()))
	if (observation.status !== 'ready') throw new Error('Expected ready')
	const f = fixture({ ...observation, signedIn: true })
	const connect = vi.fn(async () => {})
	const host: AccountHost = {
		...f.host,
		tokenIdentity: {
			binding: {},
			canSignInExisting: async () => true,
			capability: {
				isCurrentBinding: () => true,
				connectCurrentLibrary: connect,
				signInExistingLibrary: vi.fn(async () => {})
			}
		}
	}
	const rejected = vi.fn()
	const reportTo = createActor(
		fromCallback(({ receive }) => {
			receive(rejected)
		})
	).start()
	const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
	actor.send({
		type: 'CONNECT_TOKEN',
		attemptId: crypto.randomUUID(),
		accountId: 'owner',
		source: { getToken: async () => 'synthetic' },
		reportTo
	})
	await vi.waitFor(() => expect(rejected).toHaveBeenCalledOnce())
	reportTo.stop()
	actor.send({ type: 'SHUTDOWN' })
	await waitFor(actor, (s) => s.status === 'done')
	expect(connect).not.toHaveBeenCalled()
})

it('settles the token caller when shutdown cancels a pre-link library drain', async () => {
	const saving = Promise.withResolvers<import('../../contracts/storage.js').SaveResult>()
	const stop = vi.fn()
	const save = controlledSave(() => saving.promise, stop)
	const observation = ready('owner', root(Promise.resolve(), Promise.resolve()))
	if (observation.status !== 'ready') throw new Error('Expected ready')
	const id = crypto.randomUUID()
	const library = testLibraryCapability(
		{
			id,
			title: 'Synthetic',
			text: '',
			html: '',
			finalUrl: 'https://example.invalid/',
			submittedUrl: 'https://example.invalid/',
			provenance: '{}',
			imagesMissing: false
		},
		{ spawnSave: (spawn, input) => spawn(save, { input }) }
	)
	const f = fixture({ ...observation, library })
	const connect = vi.fn(async () => {})
	const host: AccountHost = {
		...f.host,
		tokenIdentity: {
			binding: {},
			canSignInExisting: async () => true,
			capability: {
				isCurrentBinding: () => true,
				connectCurrentLibrary: connect,
				signInExistingLibrary: vi.fn(async () => {})
			}
		}
	}
	const replies = vi.fn()
	const reportTo = createActor(
		fromCallback(({ receive }) => {
			receive(replies)
		})
	).start()
	const attemptId = crypto.randomUUID()
	const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
	const { selectLibraryActor } = await import('./application-readiness.js')
	const product = selectLibraryActor(actor.getSnapshot())!
	product.send({ type: 'ADD', url: 'https://example.invalid/' })
	await waitFor(product, (s) => s.matches({ running: { capture: 'saving' } }))
	actor.send({
		type: 'CONNECT_TOKEN',
		attemptId,
		accountId: 'owner',
		source: { getToken: async () => 'synthetic' },
		reportTo
	})
	await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
	actor.send({ type: 'SHUTDOWN' })
	saving.resolve({ kind: 'unknown', operationId: id })
	await waitFor(actor, (s) => s.status === 'done')
	expect(connect).not.toHaveBeenCalled()
	expect(replies).toHaveBeenCalledExactlyOnceWith({ type: 'TOKEN_CANCELLED', attemptId })
	reportTo.stop()
})

it.each(['before-issue', 'after-issue'] as const)(
	'joins both child lifetimes when shutdown occurs %s',
	async (phase) => {
		const { createAccountLifecycleMachine } = await import('./account-lifecycle.js')
		const { selectLibraryActor } = await import('./application-readiness.js')
		const accountId = crypto.randomUUID()
		const attemptId = crypto.randomUUID()
		const articleId = crypto.randomUUID()
		const saving = Promise.withResolvers<import('../../contracts/storage.js').SaveResult>()
		const issued = Promise.withResolvers<void>()
		const provider = Promise.withResolvers<Response>()
		const stopped = vi.fn()
		const save = controlledSave(() => saving.promise, stopped)
		const library = testLibraryCapability(
			{
				id: articleId,
				title: 'Synthetic',
				text: '',
				html: '',
				finalUrl: 'https://example.invalid/',
				submittedUrl: 'https://example.invalid/',
				provenance: '{}',
				imagesMissing: false
			},
			{ spawnSave: (spawn, input) => spawn(save, { input }) }
		)
		const observation = ready(accountId, root(Promise.resolve(), Promise.resolve()))
		if (observation.status !== 'ready') throw new Error('Expected ready')
		const f = fixture({ ...observation, library })
		const connect = vi.fn(() => issued.promise)
		const host: AccountHost = {
			...f.host,
			tokenIdentity: {
				binding: {},
				canSignInExisting: async () => true,
				capability: {
					isCurrentBinding: () => true,
					connectCurrentLibrary: connect,
					signInExistingLibrary: vi.fn(async () => {})
				}
			}
		}
		const records = new Map([
			['clipper.atproto.pending.v1', JSON.stringify({ operation: 'connect', accountId, attemptId })]
		])
		vi.stubGlobal(
			'fetch',
			vi.fn(() => provider.promise)
		)
		const actor = createActor(
			createAccountLifecycleMachine<AccountHost>(() => () => {}),
			{
				input: {
					account: input(host),
					oauth: {
						selection: { read: async () => undefined, save: async () => {}, clear: async () => {} },
						origin: 'https://example.invalid',
						navigate: vi.fn(),
						storage: {
							getItem: (key) => records.get(key) ?? null,
							setItem: (key, value) => {
								records.set(key, value)
							},
							removeItem: (key) => {
								records.delete(key)
							}
						}
					}
				}
			}
		).start()
		try {
			await waitFor(
				actor,
				(s) =>
					!!s.context.application &&
					selectApplicationView(s.context.application, true).canTokenIdentity
			)
			const product = selectLibraryActor(actor.getSnapshot().context.application)!
			product.send({ type: 'ADD', url: 'https://example.invalid/' })
			await waitFor(product, (s) => s.matches({ running: { capture: 'saving' } }))
			provider.resolve(Response.json({ attemptId, userId: 'provider-user' }))
			await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce())
			expect(connect).not.toHaveBeenCalled()
			if (phase === 'before-issue') actor.send({ type: 'SHUTDOWN' })
			saving.resolve({ kind: 'unknown', operationId: articleId })
			if (phase === 'after-issue') {
				await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
				actor.send({ type: 'SHUTDOWN' })
				expect(actor.getSnapshot().status).toBe('active')
				expect(host.release).not.toHaveBeenCalled()
				issued.resolve()
			}
			await waitFor(actor, (s) => s.status === 'done')
			expect(connect).toHaveBeenCalledTimes(phase === 'before-issue' ? 0 : 1)
			expect(host.release).toHaveBeenCalledOnce()
			expect(records.size).toBe(0)
		} finally {
			vi.unstubAllGlobals()
			actor.stop()
		}
	}
)

it.each(['matches', 'wrong-target'] as const)(
	'exposes a restored library only when its account %s',
	async (outcome) => {
		const localId = crypto.randomUUID()
		const expected = crypto.randomUUID()
		const actual = outcome === 'matches' ? expected : crypto.randomUUID()
		const localRoot = root(Promise.resolve(), Promise.resolve())
		const remoteRoot = root(Promise.resolve(), Promise.resolve())
		const remoteRead = vi.spyOn(remoteRoot, 'read')
		const f = fixture(ready(localId, localRoot))
		const signIn = vi.fn(async () => f.emit({ ...ready(actual, remoteRoot), signedIn: true }))
		const connect = vi.fn(async () => {})
		const host: AccountHost = {
			...f.host,
			tokenIdentity: {
				binding: {},
				canSignInExisting: async () => true,
				capability: {
					isCurrentBinding: () => true,
					connectCurrentLibrary: connect,
					signInExistingLibrary: signIn
				}
			}
		}
		const replies = vi.fn()
		const reportTo = createActor(fromCallback(({ receive }) => receive(replies))).start()
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (s) => selectApplicationView(s, true).canTokenIdentity)
		const attemptId = crypto.randomUUID()
		actor.send({
			type: 'RESTORE_TOKEN',
			accountId: localId,
			expectedAccountId: expected,
			attemptId,
			source: { getToken: async () => 'synthetic' },
			reportTo
		})
		await vi.waitFor(() => expect(replies).toHaveBeenCalledOnce())
		expect(signIn).toHaveBeenCalledOnce()
		expect(connect).not.toHaveBeenCalled()
		if (outcome === 'matches') {
			expect(replies).toHaveBeenCalledWith({
				type: 'TOKEN_SUCCEEDED',
				attemptId,
				accountId: expected
			})
			await waitFor(actor, (s) =>
				s.matches({ active: { flow: { running: { library: 'ready' } } } })
			)
			expect(remoteRead).toHaveBeenCalledOnce()
		} else {
			expect(replies).toHaveBeenCalledWith({ type: 'TOKEN_UNRESOLVED', attemptId })
			expect(
				actor.getSnapshot().matches({ active: { flow: { running: 'tokenUnresolved' } } })
			).toBe(true)
			expect(remoteRead).not.toHaveBeenCalled()
			expect(selectApplicationView(actor.getSnapshot(), true).requiresReload).toBe(true)
		}
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (s) => s.status === 'done')
		reportTo.stop()
	}
)

it('refuses restoration when local work appears while provider verification is pending', async () => {
	const { createAccountLifecycleMachine } = await import('./account-lifecycle.js')
	const localId = crypto.randomUUID()
	const target = crypto.randomUUID()
	const provider = Promise.withResolvers<Response>()
	const f = fixture(ready(localId, root(Promise.resolve(), Promise.resolve())))
	let empty = true
	const signIn = vi.fn(async () => {})
	const host: AccountHost = {
		...f.host,
		tokenIdentity: {
			binding: {},
			canSignInExisting: async () => empty,
			capability: {
				isCurrentBinding: () => true,
				connectCurrentLibrary: vi.fn(),
				signInExistingLibrary: signIn
			}
		}
	}
	vi.stubGlobal(
		'fetch',
		vi.fn(() => provider.promise)
	)
	const owner = createActor(
		createAccountLifecycleMachine<AccountHost>(() => () => {}),
		{
			input: {
				account: input(host),
				oauth: {
					origin: 'https://example.invalid',
					navigate: vi.fn(),
					storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
					selection: {
						read: async () => ({
							issuer: 'https://example.invalid',
							userId: 'provider-user',
							accountId: target
						}),
						save: vi.fn(),
						clear: vi.fn()
					}
				}
			}
		}
	).start()
	try {
		const oauth = owner.getSnapshot().children.oauth!
		await waitFor(oauth, (s) => s.matches('checkingProvider'))
		empty = false
		provider.resolve(Response.json({ user: { id: 'provider-user' } }))
		await waitFor(oauth, (s) => s.matches('failed'))
		expect(signIn).not.toHaveBeenCalled()
		owner.send({ type: 'SHUTDOWN' })
		await waitFor(owner, (s) => s.status === 'done')
	} finally {
		vi.unstubAllGlobals()
		owner.stop()
	}
})

it.each(['cleared', 'failed'] as const)(
	'removes remembered selection before logout, with cleanup %s',
	async (outcome) => {
		const observation = ready(crypto.randomUUID(), root(Promise.resolve(), Promise.resolve()))
		const f = fixture({ ...observation, signedIn: true })
		const order: string[] = []
		const forgotten = Promise.withResolvers<void>()
		const forgetTokenSelection = vi.fn(() => {
			order.push('clear')
			return forgotten.promise
		})
		const logout = vi.fn(async () => {
			order.push('logout')
			f.emit({ status: 'signed-out' })
		})
		const actor = createActor(applicationReadinessMachine, {
			input: { ...input({ ...f.host, logout }), forgetTokenSelection }
		}).start()
		await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
		actor.send({ type: 'LOGOUT' })
		await vi.waitFor(() => expect(forgetTokenSelection).toHaveBeenCalledOnce())
		expect(logout).not.toHaveBeenCalled()
		if (outcome === 'cleared') {
			forgotten.resolve()
			await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'signedOut' } } }))
			expect(order).toEqual(['clear', 'logout'])
		} else {
			forgotten.reject(new Error('Storage unavailable'))
			await waitFor(actor, (s) => selectApplicationView(s, true).feedback === 'identityFailed')
			expect(logout).not.toHaveBeenCalled()
		}
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (s) => s.status === 'done')
	}
)

it('rejects an A-to-B-to-A binding replacement during pre-issue eligibility checks', async () => {
	const empty = Promise.withResolvers<boolean>()
	const original = ready(crypto.randomUUID(), root(Promise.resolve(), Promise.resolve()))
	if (original.status !== 'ready') throw new Error('Expected ready')
	const f = fixture(original)
	const signIn = vi.fn(async () => {})
	const host: AccountHost = {
		...f.host,
		tokenIdentity: {
			binding: {},
			canSignInExisting: () => empty.promise,
			capability: {
				isCurrentBinding: () => true,
				connectCurrentLibrary: vi.fn(),
				signInExistingLibrary: signIn
			}
		}
	}
	const replies = vi.fn()
	const reportTo = createActor(fromCallback(({ receive }) => receive(replies))).start()
	const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
	await waitFor(actor, (s) => selectApplicationView(s, true).canTokenIdentity)
	actor.send({
		type: 'RESTORE_TOKEN',
		accountId: original.accountId,
		expectedAccountId: crypto.randomUUID(),
		attemptId: crypto.randomUUID(),
		source: { getToken: async () => 'synthetic' },
		reportTo
	})
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'tokenCheckingEmpty' } } }))
	f.emit({ ...original, accountId: crypto.randomUUID(), binding: {} })
	f.emit({ ...original, binding: {} })
	empty.resolve(true)
	await vi.waitFor(() => expect(replies).toHaveBeenCalledOnce())
	expect(signIn).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	await waitFor(actor, (s) => s.status === 'done')
	reportTo.stop()
})

it('restores a completed account choice across app lifetimes and keeps logout from racing its write', async () => {
	const { createAccountLifecycleMachine, selectAccountLifecycleView } =
		await import('./account-lifecycle.js')
	const { createBrowserTokenSelection } =
		await import('delightful-local-first/identity/token/selection')
	const target = crypto.randomUUID()
	const attemptId = crypto.randomUUID()
	const data = new Map<string, string>()
	const persisted = createBrowserTokenSelection(
		{
			getItem: (key) => data.get(key) ?? null,
			setItem: (key, value) => {
				data.set(key, value)
			},
			removeItem: (key) => {
				data.delete(key)
			}
		},
		'remembered'
	)
	const writing = Promise.withResolvers<void>()
	const selection = {
		...persisted,
		save: async (value: Parameters<typeof persisted.save>[0]) => {
			await writing.promise
			await persisted.save(value)
		}
	}
	const fetch = vi.fn(async (path: string) =>
		Response.json(
			path.endsWith('/completion')
				? { attemptId, userId: 'provider-user' }
				: { user: { id: 'provider-user' } }
		)
	)
	vi.stubGlobal('fetch', fetch)
	function open(withIntent: boolean) {
		const localId = crypto.randomUUID()
		const f = fixture(ready(localId, root(Promise.resolve(), Promise.resolve())))
		const signIn = vi.fn(async () =>
			f.emit({ ...ready(target, root(Promise.resolve(), Promise.resolve())), signedIn: true })
		)
		const connect = vi.fn(async () => {})
		const logout = vi.fn(async () => f.emit({ status: 'signed-out' }))
		const host: AccountHost = {
			...f.host,
			logout,
			tokenIdentity: {
				binding: {},
				canSignInExisting: async () => true,
				capability: {
					isCurrentBinding: () => true,
					connectCurrentLibrary: connect,
					signInExistingLibrary: signIn
				}
			}
		}
		const intents = new Map<string, string>()
		if (withIntent)
			intents.set(
				'clipper.atproto.pending.v1',
				JSON.stringify({ operation: 'sign-in', accountId: localId, attemptId })
			)
		const owner = createActor(
			createAccountLifecycleMachine<AccountHost>(() => () => {}),
			{
				input: {
					account: { ...input(host), forgetTokenSelection: persisted.clear },
					oauth: {
						origin: 'https://example.invalid',
						navigate: vi.fn(),
						selection,
						storage: {
							getItem: (key) => intents.get(key) ?? null,
							setItem: (key, value) => {
								intents.set(key, value)
							},
							removeItem: (key) => {
								intents.delete(key)
							}
						}
					}
				}
			}
		).start()
		return { owner, signIn, connect, logout }
	}
	const first = open(true)
	try {
		await waitFor(first.owner, (s) => s.context.oauthState?.matches('remembering') === true)
		expect(selectAccountLifecycleView(first.owner.getSnapshot(), true).canLogout).toBe(false)
		first.owner.send({ type: 'LOGOUT' })
		expect(first.logout).not.toHaveBeenCalled()
		writing.resolve()
		await waitFor(first.owner, (s) => s.context.oauthState?.matches('succeeded') === true)
		expect(await persisted.read()).toEqual({
			issuer: 'https://example.invalid',
			userId: 'provider-user',
			accountId: target
		})
		first.owner.send({ type: 'SHUTDOWN' })
		await waitFor(first.owner, (s) => s.status === 'done')
		const restored = open(false)
		try {
			await waitFor(restored.owner, (s) => s.context.oauthState?.matches('succeeded') === true)
			const observation = restored.owner.getSnapshot().context.application?.context.observation
			expect(observation?.status === 'ready' && observation.accountId).toBe(target)
			expect(restored.signIn).toHaveBeenCalledOnce()
			expect(restored.connect).not.toHaveBeenCalled()
			expect(fetch.mock.calls.map(([path]) => path)).toEqual([
				'/api/auth/atproto/completion',
				'/api/auth/get-session'
			])
			await waitFor(restored.owner, (s) => selectAccountLifecycleView(s, true).canLogout)
			restored.owner.send({ type: 'LOGOUT' })
			await waitFor(restored.owner, (s) => s.context.oauthState?.matches('idle') === true)
			expect(restored.logout).toHaveBeenCalledOnce()
			expect(await persisted.read()).toBeUndefined()
			restored.owner.send({ type: 'SHUTDOWN' })
			await waitFor(restored.owner, (s) => s.status === 'done')
		} finally {
			restored.owner.stop()
		}
		fetch.mockClear()
		const signedOut = open(false)
		try {
			await waitFor(signedOut.owner, (s) => s.context.oauthState?.matches('idle') === true)
			expect(fetch).not.toHaveBeenCalled()
			expect(signedOut.signIn).not.toHaveBeenCalled()
			signedOut.owner.send({ type: 'SHUTDOWN' })
			await waitFor(signedOut.owner, (s) => s.status === 'done')
		} finally {
			signedOut.owner.stop()
		}
	} finally {
		first.owner.stop()
		vi.unstubAllGlobals()
	}
})
