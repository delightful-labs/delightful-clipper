import { spawn } from 'node:child_process'
import type { PreviewJazzApp } from './preview-machine.ts'

const serverUrl = 'https://v2.sync.jazz.tools/'
const provisionUrl = 'https://v2.dashboard.jazz.tools/api/apps/generate'
function credentials(value: unknown): PreviewJazzApp {
	if (
		!value ||
		typeof value !== 'object' ||
		!('appId' in value) ||
		!('adminSecret' in value) ||
		typeof value.appId !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.appId) ||
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

/** Own one process group until close, including interrupted pnpm subprocesses. */
export function run(command: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted()
		const grouped = process.platform !== 'win32'
		const child = spawn('pnpm', [command], {
			env,
			detached: grouped,
			// Jazz errors can contain server payloads. Never echo its private environment/output.
			stdio: command === 'build' ? 'inherit' : ['ignore', 'ignore', 'pipe']
		})
		let deploymentError = ''
		child.stderr?.on('data', (chunk: Buffer) => {
			// Retain only a bounded buffer; print no server text or credentials.
			deploymentError = (deploymentError + chunk.toString()).slice(-16_384)
		})
		let killTimer: ReturnType<typeof setTimeout> | undefined
		function kill(killSignal: NodeJS.Signals) {
			if (!child.pid) return
			try {
				if (grouped) process.kill(-child.pid, killSignal)
				else child.kill(killSignal)
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
			}
		}
		function abort() {
			kill('SIGTERM')
			killTimer = setTimeout(() => kill('SIGKILL'), 5_000)
			killTimer.unref()
		}
		function cleanup() {
			signal.removeEventListener('abort', abort)
			clearTimeout(killTimer)
		}
		signal.addEventListener('abort', abort, { once: true })
		child.once('error', () => {
			cleanup()
			reject(new Error(`Could not start ${command}`))
		})
		child.once('close', (code) => {
			cleanup()
			if (signal.aborted) reject(new Error(`${command} cancelled`))
			else if (code !== 0) {
				const httpStatus = deploymentError.match(
					/(?:Permissions head fetch|Schema publish|Schema fetch|Schema list fetch|Permissions publish|Migration publish) failed:\s*(\d{3})\b/
				)?.[1]
				if (httpStatus)
					console.error(`[preview-build] Jazz admin request failed with HTTP ${httpStatus}.`)
				reject(new Error(`${command} failed with exit code ${code}`))
			} else resolve()
		})
	})
}
