import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { libraryMachine, selectLibraryView } from './library.js'
import { testLibraryCapability } from './library.test-support.js'
import { createOrganizationMachine, type OrganizationDraft } from '../storage/organize.js'
import type { SyncReceipt } from '../../contracts/storage.js'
const id = crypto.randomUUID()
const candidate = {
	id,
	title: '',
	text: '',
	html: '',
	finalUrl: 'https://example.com',
	submittedUrl: 'https://example.com',
	provenance: '{}',
	imagesMissing: false
}
const row = {
	id,
	title: 'Saved article',
	contentId: id,
	url: candidate.finalUrl,
	originalSavedAt: '',
	failure: null,
	status: 'inbox' as const,
	favorite: true
}
function fixture(local = async () => {}, global = async () => {}) {
	const commit = vi.fn(() => ({}))
	const stage = createWorkspaceCreationTransaction<
		OrganizationDraft,
		object,
		null,
		SyncReceipt,
		object
	>({
		open: () => ({}),
		readLocal: async () => null,
		assess: () => ({ outcome: 'eligible' }),
		stage: () => ({ global }),
		commit,
		persistLocal: local,
		rollback: () => true
	})
	const machine = createOrganizationMachine(stage, () => true)
	const actor = createActor(libraryMachine, {
		input: testLibraryCapability(candidate, {
			spawnOrganization: (spawn, request) => spawn(machine, { input: request })
		})
	}).start()
	actor.send({ type: 'ROWS', rows: [row] })
	return { actor, commit }
}
it('filters observed rows without rewriting status or favorite, and rejects invalid commands', async () => {
	const { actor, commit } = fixture()
	actor.send({ type: 'FILTER', view: 'later', favorites: true })
	expect(selectLibraryView(actor.getSnapshot()).rows).toEqual([])
	actor.send({ type: 'FILTER', view: 'inbox', favorites: true })
	expect(selectLibraryView(actor.getSnapshot()).rows).toEqual([row])
	actor.send({
		type: 'ORGANIZE',
		request: { id: crypto.randomUUID(), field: 'status', value: 'later' }
	})
	expect(commit).not.toHaveBeenCalled()
	expect(actor.getSnapshot().context.rows).toEqual([row])
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('drains an issued organization write before library shutdown and clears private command resources', async () => {
	const entered = Promise.withResolvers<void>(),
		local = Promise.withResolvers<void>()
	const { actor, commit } = fixture(async () => {
		entered.resolve()
		await local.promise
	})
	actor.send({ type: 'ORGANIZE', request: { id, field: 'status', value: 'archive' } })
	await entered.promise
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	expect(selectLibraryView(actor.getSnapshot()).rows).toEqual([])
	local.resolve()
	await toPromise(actor)
	expect(commit).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context.organizationRef).toBeUndefined()
	expect(actor.getSnapshot().context.organizationRequest).toBeUndefined()
})
it('observes each independent receipt and retains earlier rejection after another field succeeds', async () => {
	const first = Promise.withResolvers<void>(),
		second = Promise.withResolvers<void>()
	let sequence = 0
	const { actor } = fixture(
		async () => {},
		() => (++sequence === 1 ? first.promise : second.promise)
	)
	actor.send({ type: 'ORGANIZE', request: { id, field: 'favorite', value: false } })
	await waitFor(actor, (s) => s.matches({ running: { organization: 'saved' } }))
	actor.send({ type: 'ORGANIZE', request: { id, field: 'status', value: 'later' } })
	await waitFor(actor, (s) => s.matches({ running: { organization: 'saved' } }))
	expect(Object.keys(actor.getSnapshot().context.organizationOperations)).toHaveLength(2)
	first.reject(new Error('remote rejection'))
	second.resolve()
	await waitFor(
		actor,
		(s) =>
			Object.values(s.context.sync).includes('rejected') &&
			Object.values(s.context.sync).includes('accepted')
	)
	expect(selectLibraryView(actor.getSnapshot()).organizationMessage?.variant).toBe('error')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
