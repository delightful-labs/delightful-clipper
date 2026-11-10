import { expect, it, vi } from 'vitest'
import type { SyncStatus } from 'jazz-tools'
import { readConnection } from './read-connection.js'

it('registers before publishing the current link and releases the native subscription', () => {
	let status: SyncStatus = { link: { state: 'connecting' }, pendingUploads: 0, synced: false }
	let changed: (() => void) | undefined
	const release = vi.fn()
	const db = {
		onSyncStatusChange: vi.fn((listener: () => void) => {
			changed = listener
			return release
		}),
		getSyncStatus: vi.fn(() => {
			expect(changed).toBeDefined()
			return status
		})
	}
	const next = vi.fn()
	const stop = readConnection(db)(next)
	expect(next.mock.calls).toEqual([['connecting']])
	status = { link: { state: 'connected' }, pendingUploads: 0, synced: true }
	changed?.()
	expect(next.mock.calls).toEqual([['connecting'], ['connected']])
	stop()
	expect(release).toHaveBeenCalledOnce()
})
it('releases a native subscription if its initial publication fails', () => {
	const release = vi.fn()
	const db = {
		onSyncStatusChange: () => release,
		getSyncStatus: (): SyncStatus => {
			throw new Error('Closed scope')
		}
	}
	expect(() => readConnection(db)(vi.fn())).toThrow('Closed scope')
	expect(release).toHaveBeenCalledOnce()
})
