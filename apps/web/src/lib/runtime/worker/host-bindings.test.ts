import { afterEach, expect, it, vi } from 'vitest'
import { SimulatedClock, waitFor } from 'xstate'
import type {
	AccountHost,
	AccountObservation,
	ReadyAccountObservation
} from '../../contracts/account.js'
import {
	testLibraryCapability,
	controlledSave
} from '../../machines/capture/library.test-support.js'
import type { LibraryCapability } from '../../contracts/library.js'
import type { SaveResult } from '../../contracts/storage.js'
import { createWorkerHostFixture } from './host-machine.test-support.js'

const cleanups = new Set<() => void>()
afterEach(() => {
	for (const cleanup of cleanups) cleanup()
	cleanups.clear()
	vi.restoreAllMocks()
})
function fixture() {
	const listeners = new Set<() => void>(),
		releaseRecovery = vi.fn(),
		observeRecovery = vi.fn()
	const native = (accountId: string): ReadyAccountObservation => ({
		status: 'ready',
		binding: {},
		clientBinding: {},
		databaseBinding: {},
		accountId,
		localFirst: true,
		root: { read: async () => 'compatible', ensure: vi.fn() },
		recovery: {
			capability: { isCurrentScope: () => false, readPhrase: async () => '' },
			source: {
				subscribe: (notify) => {
					observeRecovery(accountId)
					notify({ kind: 'unavailable' })
					return () => releaseRecovery(accountId)
				}
			}
		}
	})
	let current: AccountObservation = native('A')
	const releases: ReturnType<typeof vi.fn>[] = [],
		libraries = new Map<string, LibraryCapability>()
	const adopt = vi.fn((observation: ReadyAccountObservation) => {
		const release = vi.fn()
		releases.push(release)
		const id = crypto.randomUUID()
		const library =
			libraries.get(observation.accountId) ??
			testLibraryCapability({
				id,
				title: observation.accountId,
				text: 'local',
				html: '<p>local</p>',
				submittedUrl: 'https://example.com/',
				finalUrl: 'https://example.com/',
				provenance: '{}',
				imagesMissing: false
			})
		return { observation: { ...observation, library }, release }
	})
	const unused = vi.fn(async () => {})
	const account: AccountHost = {
		read: () => current,
		adopt,
		readiness: {
			binding: {},
			capability: {
				readStatus: () => current.status,
				subscribe: (notify) => {
					listeners.add(notify)
					return () => listeners.delete(notify)
				},
				retry: unused
			}
		},
		create: unused,
		logout: unused,
		release: vi.fn(),
		restoration: {
			binding: {},
			capability: {
				isCurrentBinding: () => false,
				parsePhrase: async () => {
					throw new Error('Unused restoration')
				},
				readIdentity: async () => ({ kind: 'unavailable' }),
				restoreIdentity: unused
			}
		}
	}
	const emit = (observation: AccountObservation) => {
		current = observation
		for (const notify of listeners) notify()
	}
	return {
		account,
		native,
		emit,
		current: () => current,
		adopt,
		releases,
		libraries,
		observeRecovery,
		releaseRecovery
	}
}
it('owns one recovery/tag/subscription set for duplicate native binding observations', async () => {
	const native = fixture(),
		f = createWorkerHostFixture(undefined, undefined, undefined, { account: native.account })
	cleanups.add(() => {
		f.actor.stop()
		f.owner.stop()
	})
	f.actor.start()
	await waitFor(f.actor, (s) => !!s.context.library && !!s.context.recovery, { timeout: 1000 })
	const before = f.actor.getSnapshot().context
	for (let index = 0; index < 4; index++) native.emit({ ...native.current() })
	await vi.waitFor(() => expect(f.actor.getSnapshot().context.library).toBe(before.library))
	expect(f.actor.getSnapshot().context.scope).toBe(before.scope)
	expect(f.actor.getSnapshot().context.tagForm).toBe(before.tagForm)
	expect(f.actor.getSnapshot().context.recovery).toBe(before.recovery)
	expect(native.adopt).toHaveBeenCalledOnce()
	expect(native.observeRecovery).toHaveBeenCalledExactlyOnceWith('A')
	f.actor.send({ type: 'SHUTDOWN' })
	await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
	expect(native.releaseRecovery).toHaveBeenCalledExactlyOnceWith('A')
	expect(native.releases[0]).toHaveBeenCalledOnce()
})
it('A → B → C retires Window resources before publishing the latest binding and refuses stale scope/facts', async () => {
	const native = fixture(),
		f = createWorkerHostFixture(undefined, undefined, undefined, { account: native.account })
	const port = new MessageChannel(),
		commands: { type: string; id?: string }[] = []
	port.port1.onmessage = (event) => commands.push(event.data)
	cleanups.add(() => {
		f.actor.stop()
		f.owner.stop()
		port.port1.close()
	})
	f.actor.start()
	await waitFor(f.actor, (s) => !!s.context.library, { timeout: 1000 })
	const a = f.actor.getSnapshot().context
	// Refused/unopened surfaces still own native listeners and need real cleanup.
	f.actor.send({
		type: 'ATTACH_BOUND',
		scope: a.scope,
		documentId: crypto.randomUUID(),
		sources: [],
		port: port.port2,
		fullscreen: { supported: false, active: false }
	})
	await vi.waitFor(() => expect(commands.some((command) => command.type === 'DISPOSE')).toBe(true))
	native.emit(native.native('B'))
	native.emit(native.native('C'))
	await waitFor(f.actor, (s) => s.matches({ running: { accepting: 'retiring' } }), {
		timeout: 1000
	})
	await vi.waitFor(() =>
		expect(native.adopt).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 'C' }))
	)
	expect(f.actor.getSnapshot().context.library).toBeUndefined()
	f.actor.send({ type: 'MORE', scope: a.scope })
	expect(f.actor.getSnapshot().context.limit).toBe(50)
	const id = commands.find((command) => command.type === 'DISPOSE')?.id
	if (!id) throw new Error('Missing native cleanup identity')
	port.port1.postMessage({ type: 'DISPOSED', id })
	await waitFor(f.actor, (s) => !!s.context.library && s.context.scope !== a.scope, {
		timeout: 1000
	})
	const c = f.actor.getSnapshot().context
	f.actor.send({ type: 'MORE', scope: a.scope })
	expect(f.actor.getSnapshot().context.limit).toBe(50)
	if (!c.library) throw new Error('Missing C library')
	f.actor.send({
		type: 'LIBRARY_OBSERVED',
		generation: a.bindingGeneration,
		facts: { library: c.library, active: false, documentId: undefined, tags: {} }
	})
	expect(f.actor.getSnapshot().context.facts?.active).toBe(true)
	expect(native.observeRecovery.mock.calls.map(([id]) => id)).toEqual(['A', 'C'])
	expect(native.releaseRecovery).toHaveBeenCalledExactlyOnceWith('A')
})
it('reports an overdue domain drain without closing the SDK or abandoning the original issued write', async () => {
	const native = fixture(),
		clock = new SimulatedClock(),
		pending = Promise.withResolvers<SaveResult>()
	const issued = vi.fn(() => pending.promise),
		save = controlledSave(issued),
		id = crypto.randomUUID()
	native.libraries.set(
		'A',
		testLibraryCapability(
			{
				id,
				title: 'A',
				text: '',
				html: '',
				submittedUrl: 'https://example.com/',
				finalUrl: 'https://example.com/',
				provenance: '{}',
				imagesMissing: false
			},
			{ spawnSave: (spawn, request) => spawn(save, { input: request }) }
		)
	)
	const f = createWorkerHostFixture(undefined, undefined, undefined, {
		account: native.account,
		clock,
		closePolicy: { drainMs: 5 }
	})
	cleanups.add(() => {
		pending.resolve({ kind: 'unknown', operationId: id })
		f.actor.stop()
		f.owner.stop()
	})
	f.actor.start()
	await waitFor(f.actor, (s) => !!s.context.library, { timeout: 1000 })
	const original = f.actor.getSnapshot().context
	f.actor.send({
		type: 'LIBRARY',
		scope: original.scope,
		requestId: crypto.randomUUID(),
		event: { type: 'ADD', url: 'https://example.com/' }
	})
	await vi.waitFor(() => expect(issued).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	clock.increment(5)
	expect(f.actor.getSnapshot().context.closeIssue).toEqual({
		stage: 'application',
		reason: 'overdue'
	})
	expect(f.close).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().status).toBe('active')
	pending.resolve({ kind: 'unknown', operationId: id })
	await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
	expect(issued).toHaveBeenCalledOnce()
	expect(f.close).toHaveBeenCalledOnce()
})
