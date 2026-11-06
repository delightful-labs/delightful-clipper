import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { libraryMachine, selectLibraryView } from './library.js'
import { testLibraryCapability } from './library.test-support.js'
import type { ReaderChange } from '../../reader/schema.js'
import type { SyncReceipt } from '../../contracts/storage.js'
it('keeps the main library alive until its reader write drains and rejects new reader commands while closing', async () => {
	const entered = Promise.withResolvers<void>(),
		local = Promise.withResolvers<void>(),
		commit = vi.fn(() => ({})),
		dispose = vi.fn()
	const stage = createWorkspaceCreationTransaction<ReaderChange, object, null, SyncReceipt, object>(
		{
			open: () => ({}),
			readLocal: async () => null,
			assess: () => ({ outcome: 'eligible' }),
			stage: () => ({ global: async () => {} }),
			commit,
			persistLocal: async () => {
				entered.resolve()
				await local.promise
			},
			rollback: () => true
		}
	)
	const candidate = {
		id: crypto.randomUUID(),
		title: '',
		text: '',
		html: '',
		finalUrl: 'https://example.com/',
		submittedUrl: 'https://example.com/',
		provenance: '{}',
		imagesMissing: false
	}
	const actor = createActor(libraryMachine, {
		input: testLibraryCapability(candidate, {
			reader: {
				isCurrent: () => true,
				subscribe: (next) => {
					next([])
					return dispose
				},
				spawnWrite: (spawn, draft, operationId) =>
					spawn(stage, {
						input: {
							attempt: { operationId, workspaceId: operationId, membershipId: operationId, draft }
						}
					})
			}
		})
	}).start()
	actor.send({
		type: 'READER_EVENT',
		event: { type: 'CHANGE', change: { documentId: null, field: 'theme', value: 'dark' } }
	})
	await entered.promise
	actor.send({ type: 'SHUTDOWN' })
	actor.send({
		type: 'READER_EVENT',
		event: { type: 'CHANGE', change: { documentId: null, field: 'size', value: 26 } }
	})
	expect(actor.getSnapshot().status).toBe('active')
	expect(dispose).toHaveBeenCalledOnce()
	expect(selectLibraryView(actor.getSnapshot()).readerExperience.preferences.theme).toBe('system')
	local.resolve()
	await toPromise(actor)
	expect(commit).toHaveBeenCalledOnce()
})
