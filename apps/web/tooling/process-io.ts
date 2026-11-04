import { spawn } from 'node:child_process'
import type { ProcessOpen } from './process-machine.ts'
/** Spawn, signal and event translation only; grace-period/escalation policy belongs to the machine. */
export const openPreviewProcess: ProcessOpen = (input, report) => {
	const grouped = process.platform !== 'win32'
	const child = spawn('pnpm', [input.command], {
		env: input.env,
		detached: grouped,
		stdio: input.command === 'build' ? 'inherit' : ['ignore', 'ignore', 'pipe']
	})
	let deploymentError = ''
	const data = (chunk: Buffer) => {
		deploymentError = (deploymentError + chunk.toString()).slice(-16384)
	}
	const error = () => report({ type: 'ERROR' })
	const close = (code: number | null) => {
		const httpStatus = deploymentError.match(
			/(?:Permissions head fetch|Schema publish|Schema fetch|Schema list fetch|Permissions publish|Migration publish) failed:\s*(\d{3})\b/
		)?.[1]
		report({ type: 'CLOSE', code, ...(httpStatus ? { httpStatus } : {}) })
	}
	const signal = (value: NodeJS.Signals) => {
		if (!child.pid) return
		try {
			if (grouped) process.kill(-child.pid, value)
			else child.kill(value)
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
		}
	}
	child.stderr?.on('data', data)
	child.once('error', error)
	child.once('close', close)
	return {
		signal,
		release: () => {
			child.stderr?.off('data', data)
			child.off('error', error)
			child.off('close', close)
			deploymentError = ''
			// Forced actor disposal still requests physical cleanup; normal settlement follows close.
			if (child.exitCode === null && child.signalCode === null) signal('SIGKILL')
		}
	}
}
