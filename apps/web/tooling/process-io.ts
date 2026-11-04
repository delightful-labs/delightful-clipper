import { spawn } from 'node:child_process'
import type { ProcessEvent, ProcessOpen, ProcessPort } from './process-machine.ts'
type NativeInput = {
	file: string
	args: string[]
	env: NodeJS.ProcessEnv
	stderr: 'inherit' | 'pipe'
}
function hasErrorCode(error: unknown, code: string) {
	return error instanceof Error && 'code' in error && error.code === code
}
// Releasing before Node emits an asynchronous spawn error must not create an unhandled error.
// This static sink retains no owner, environment or diagnostic data.
const ignoreDetachedError = () => {}
/** Native I/O only. Lifecycle, diagnostics and escalation policy belong to the machine. */
export function openNodeProcess(
	input: NativeInput,
	report: (event: ProcessEvent) => void
): ProcessPort {
	const grouped = process.platform !== 'win32'
	const child = spawn(input.file, input.args, {
		env: input.env,
		detached: grouped,
		stdio: input.stderr === 'inherit' ? 'inherit' : ['ignore', 'ignore', 'pipe']
	})
	const spawned = () => report({ type: 'SPAWNED' })
	const error = () => report({ type: 'PROCESS_ERROR' })
	const close = (code: number | null) => report({ type: 'CLOSE', code })
	const data = (chunk: Buffer) => report({ type: 'STDERR', text: chunk.toString() })
	const target = () => (grouped && child.pid !== undefined ? -child.pid : child.pid)
	child.once('spawn', spawned)
	child.on('error', error)
	child.once('close', close)
	child.stderr?.on('data', data)
	return {
		signal: (value) => {
			const pid = target()
			if (pid === undefined) return
			try {
				process.kill(pid, value)
			} catch (error) {
				if (!hasErrorCode(error, 'ESRCH')) throw error
			}
		},
		isAlive: () => {
			const pid = target()
			if (pid === undefined) return false
			try {
				process.kill(pid, 0)
				return true
			} catch (error) {
				if (hasErrorCode(error, 'ESRCH')) return false
				if (hasErrorCode(error, 'EPERM')) return true
				throw error
			}
		},
		release: () => {
			child.off('spawn', spawned)
			child.off('error', error)
			child.off('error', ignoreDetachedError)
			child.on('error', ignoreDetachedError)
			child.off('close', close)
			child.stderr?.off('data', data)
		}
	}
}
export const openPreviewProcess: ProcessOpen = (input, report) =>
	openNodeProcess(
		{
			file: 'pnpm',
			args: [input.command],
			env: input.env,
			stderr: input.command === 'build' ? 'inherit' : 'pipe'
		},
		report
	)
