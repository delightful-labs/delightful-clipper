import { z } from 'zod'
import { openApplicationClient } from '../../src/lib/runtime/worker/client.js'
import type { WorkerReply } from '../../src/lib/runtime/worker/client.js'
import { fixtureServerUrl } from '../browser-account-store.js'

const { PUBLIC_JAZZ_APP_ID } = z
	.object({ PUBLIC_JAZZ_APP_ID: z.string().uuid() })
	.parse(import.meta.env)

export async function qualifyForcedHostStop() {
	const worker = new Worker(new URL('./host-stop.worker.ts', import.meta.url), { type: 'module' })
	const closure: string[] = []
	worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
		if (data.type === 'CLOSED' || data.type === 'NAVIGATE') closure.push(data.type)
	})
	let failures = 0
	let releases = 0
	let ready = false
	let finish: (outcome: string) => void = () => {}
	const result = new Promise<string>((resolve) => {
		finish = resolve
	})
	const client = openApplicationClient({
		appId: PUBLIC_JAZZ_APP_ID,
		serverUrl: fixtureServerUrl(),
		createWorker: () => ({
			worker,
			release: () => {
				releases++
				finish('released')
			}
		}),
		publish: (view) => {
			if (!view.library || ready) return
			ready = true
			worker.postMessage({ type: 'FORCE_STOP_HOST' })
		},
		recovery: () => {},
		failed: () => {
			failures++
			finish(ready ? 'failed-after-stop' : 'startup-failed')
		}
	})
	try {
		const outcome = await result
		return { outcome, failures, releases, closure }
	} finally {
		client.close()
		// Isolated test teardown is deliberately disruptive. It must not be
		// mistaken for acknowledged production shutdown by the client above.
		worker.terminate()
	}
}
