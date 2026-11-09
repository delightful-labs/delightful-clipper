import { accountStorageKey } from './storage-channel.js'
import { afterEach, expect, it, vi } from 'vitest'
import { openApplicationClient } from './client.js'
import type { WorkerReply } from './client.js'
import type { RuntimeView } from './views.js'
class NativeWorker {
	static latest: NativeWorker | undefined
	onmessage: ((event: { data: WorkerReply }) => void) | null = null
	onerror: (() => void) | null = null
	onmessageerror: (() => void) | null = null
	postMessage = vi.fn()
	terminate = vi.fn()
	constructor() {
		NativeWorker.latest = this
	}
	emit(data: WorkerReply) {
		this.onmessage?.({ data })
	}
}
const view: RuntimeView = {
	type: 'VIEW',
	scope: crypto.randomUUID(),
	library: undefined,
	worker: { windowPresent: false },
	account: {
		status: 'starting',
		message: { text: '', variant: 'info' },
		feedbackMessage: undefined,
		connectionMessage: undefined,
		feedback: undefined,
		showIdentityForm: false,
		canLogout: false,
		canRestore: false,
		canRetry: false,
		requiresReload: false
	}
}
afterEach(() => vi.unstubAllGlobals())
it.each(['failure', 'detach'])(
	'stops delivering render and sensitive recovery views after UI %s, and waits for the worker close acknowledgment',
	(phase) => {
		vi.stubGlobal('Worker', NativeWorker)
		vi.stubGlobal('window', new EventTarget())
		vi.stubGlobal('navigator', { onLine: true })
		const publish = vi.fn(),
			recovery = vi.fn(),
			failed = vi.fn()
		const client = openApplicationClient({
			appId: crypto.randomUUID(),
			serverUrl: 'https://example.com',
			publish,
			recovery,
			failed
		})
		const worker = NativeWorker.latest
		if (!worker) throw new Error('Worker fixture unavailable')
		worker.emit(view)
		expect(publish).toHaveBeenCalledTimes(1)
		if (phase === 'failure') worker.onerror?.()
		else client.close()
		worker.emit(view)
		worker.emit({
			type: 'RECOVERY',
			scope: view.scope,
			available: true,
			view: { kind: 'revealed', phrase: 'test-only fixture', confirmation: 'unconfirmed' }
		})
		expect(publish).toHaveBeenCalledTimes(1)
		expect(recovery).not.toHaveBeenCalled()
		expect(worker.terminate).not.toHaveBeenCalled()
		if (phase === 'failure') client.close()
		worker.emit({ type: 'CLOSED' })
		expect(worker.terminate).toHaveBeenCalledTimes(1)
		expect(worker.onmessage).toBeNull()
	}
)

it('binds the alpha.60 namespace before serving the worker account read', async () => {
	vi.stubGlobal('Worker', NativeWorker)
	vi.stubGlobal('window', new EventTarget())
	vi.stubGlobal('navigator', { onLine: true })
	const getItem = vi.fn(() => 'opaque-test-selection')
	vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() })
	const client = openApplicationClient({
		appId: crypto.randomUUID(),
		serverUrl: 'https://example.com/jazz',
		publish: vi.fn(),
		recovery: vi.fn(),
		failed: vi.fn()
	})
	const worker = NativeWorker.latest
	if (!worker) throw new Error('Worker fixture unavailable')
	const initialize: { storage: MessagePort } | undefined = worker.postMessage.mock.calls[0]?.[0]
	if (!initialize) throw new Error('Worker initialization missing')
	const replies: unknown[] = []
	initialize.storage.onmessage = (event) => replies.push(event.data)
	initialize.storage.start()
	const id = crypto.randomUUID()
	const key = accountStorageKey('https://example.com/jazz')
	try {
		worker.emit({ type: 'STORAGE_NAMESPACE', key })
		initialize.storage.postMessage({ type: 'READ', id })
		await vi.waitFor(() =>
			expect(replies).toEqual([{ type: 'RESULT', id, value: 'opaque-test-selection' }])
		)
		expect(getItem).toHaveBeenCalledExactlyOnceWith(key)
	} finally {
		client.close()
		worker.emit({ type: 'CLOSED' })
	}
})
