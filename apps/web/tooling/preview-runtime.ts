import { isUuid } from '../src/lib/validation/values.ts'
import { createActor, toPromise } from 'xstate'
import { createProcessMachine } from './process-machine.ts'
import { openPreviewProcess } from './process-io.ts'
import type { PreviewJazzApp } from './preview-machine.ts'

const serverUrl = 'https://v2.sync.jazz.tools/'
const provisionUrl = 'https://v2.dashboard.jazz.tools/api/apps/generate'
function credentials(value: unknown): PreviewJazzApp {
	if (
		!value ||
		typeof value !== 'object' ||
		!('appId' in value) ||
		!('adminSecret' in value) ||
		!isUuid(value.appId) ||
		typeof value.adminSecret !== 'string' ||
		!value.adminSecret.trim()
	)
		throw new Error('Invalid provisioning response')
	return { appId: value.appId, adminSecret: value.adminSecret }
}

export async function provision(signal: AbortSignal): Promise<PreviewJazzApp> {
	const response = await fetch(provisionUrl, {
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)])
	})
	if (!response.ok) throw new Error(`Jazz provisioning returned HTTP ${response.status}`)
	const body: unknown = await response.json()
	return credentials(body)
}

export async function waitForApp(
	app: PreviewJazzApp,
	signal: AbortSignal
): Promise<'ready' | 'pending'> {
	const startedAt = performance.now()
	try {
		const response = await fetch(`${serverUrl}apps/${app.appId}/admin/permissions/head`, {
			headers: { 'X-Jazz-Admin-Secret': app.adminSecret },
			redirect: 'error',
			signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)])
		})
		console.info(
			`[preview-build] Jazz readiness HTTP ${response.status} after ${Math.round(performance.now() - startedAt)}ms.`
		)
		await response.body?.cancel()
		if (
			response.status === 404 ||
			response.status === 502 ||
			response.status === 503 ||
			response.status === 504
		)
			return 'pending'
		if (!response.ok) {
			console.error(`[preview-build] Jazz readiness request failed with HTTP ${response.status}.`)
			throw new Error('Jazz readiness request failed')
		}
		return 'ready'
	} catch (error) {
		// A cold app can take longer than an individual request deadline to start.
		if (!signal.aborted && error instanceof DOMException && error.name === 'TimeoutError') {
			console.info('[preview-build] Jazz readiness request timed out.')
			return 'pending'
		}
		if (!signal.aborted)
			console.error('[preview-build] Jazz readiness request failed; details withheld.')
		throw error
	}
}

export function previewEnvironment(appId: string): NodeJS.ProcessEnv {
	const env = { ...process.env }
	// Never hand inherited production/preview credentials to the frontend build.
	delete env.JAZZ_ADMIN_SECRET
	delete env.BACKEND_SECRET
	delete env.JAZZ_BACKEND_SECRET
	return {
		...env,
		JAZZ_APP_ID: appId,
		JAZZ_SERVER_URL: serverUrl,
		PUBLIC_JAZZ_APP_ID: appId,
		PUBLIC_JAZZ_SERVER_URL: serverUrl,
		JAZZ_ACCOUNT_REGISTRY: `${serverUrl}apps/${appId}/accounts`
	}
}

const processMachine = createProcessMachine(openPreviewProcess)
/** Attach the caller's abort signal; the process machine owns escalation and close settlement. */
export async function run(
	command: string,
	env: NodeJS.ProcessEnv,
	signal: AbortSignal
): Promise<void> {
	signal.throwIfAborted()
	const actor = createActor(processMachine, { input: { command, env } })
	const abort = () => {
		if (actor.getSnapshot().status === 'active') actor.send({ type: 'CANCEL' })
	}
	signal.addEventListener('abort', abort, { once: true })
	try {
		actor.start()
		if (signal.aborted) abort()
		const result = await toPromise(actor)
		if (result.outcome === 'cancelled') throw new Error(`${command} cancelled`)
		if (result.outcome === 'failed') {
			if (result.startFailed) throw new Error(`Could not start ${command}`)
			if (result.httpStatus)
				console.error(`[preview-build] Jazz admin request failed with HTTP ${result.httpStatus}.`)
			throw new Error(`${command} failed with exit code ${result.code}`)
		}
	} finally {
		signal.removeEventListener('abort', abort)
		actor.stop()
	}
}
