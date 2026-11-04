import { expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { openNodeProcess } from './process-io.js'
import { createProcessMachine } from './process-machine.js'
import type { ProcessEvent, ProcessPort } from './process-machine.js'
const eventually = (check: () => void) => vi.waitFor(check, { timeout: 5000 })
function stopDescendant(pid: number | undefined) {
	if (pid === undefined) return
	try {
		process.kill(pid, 'SIGKILL')
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
	}
}
const native = (script: string, report: (event: ProcessEvent) => void) =>
	openNodeProcess({ file: process.execPath, args: ['-e', script], env: {}, stderr: 'pipe' }, report)
it('translates actual spawn/stderr/close events without interpreting diagnostics', async () => {
	const events: ProcessEvent[] = []
	const port = native(
		"process.stderr.write('Schema publish failed: 403\\n'); process.exitCode = 1",
		(event) => events.push(event)
	)
	try {
		await eventually(() => expect(events.some((event) => event.type === 'CLOSE')).toBe(true))
		expect(events[0]).toEqual({ type: 'SPAWNED' })
		expect(events.find((event) => event.type === 'STDERR')).toMatchObject({
			text: 'Schema publish failed: 403\n'
		})
		expect(events.find((event) => event.type === 'CLOSE')).toEqual({ type: 'CLOSE', code: 1 })
		expect(port.isAlive()).toBe(false)
	} finally {
		port.signal('SIGKILL')
		port.release()
	}
})
it('release only detaches listeners; termination is an explicit command', async () => {
	const events: ProcessEvent[] = []
	const port = native("process.stderr.write('READY\\n'); setInterval(() => {}, 1000)", (event) =>
		events.push(event)
	)
	try {
		await eventually(() => expect(events.some((event) => event.type === 'STDERR')).toBe(true))
		port.release()
		expect(port.isAlive()).toBe(true)
		const count = events.length
		port.signal('SIGTERM')
		await eventually(() => expect(port.isAlive()).toBe(false))
		expect(events).toHaveLength(count)
	} finally {
		port.signal('SIGKILL')
		port.release()
	}
})
it('classifies actual asynchronous spawn failure and waits for native close', async () => {
	const events: ProcessEvent[] = []
	const actor = createActor(
		createProcessMachine((_input, report) =>
			openNodeProcess(
				{ file: '/nonexistent/clipper-process-fixture', args: [], env: {}, stderr: 'pipe' },
				(event) => {
					events.push(event)
					report(event)
				}
			)
		),
		{ input: { command: 'fixture', env: {} } }
	).start()
	try {
		expect(await toPromise(actor)).toMatchObject({
			outcome: 'failed',
			startFailed: true,
			signalFailed: false
		})
		expect(events.map((event) => event.type)).toEqual(['PROCESS_ERROR', 'CLOSE'])
	} finally {
		actor.stop()
	}
})
it.skipIf(process.platform === 'win32')(
	'kills a surviving descendant after its direct parent closes',
	async () => {
		const clock = new SimulatedClock()
		let port: ProcessPort | undefined,
			ready = false,
			closed = false,
			descendant: number | undefined
		const signals: string[] = []
		const script = `
		const { spawn } = require('node:child_process')
		const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
		child.on('message', () => process.stderr.write('DESCENDANT_READY:' + child.pid + '\\n'))
		process.on('SIGTERM', () => process.exit(0))
		setInterval(() => {}, 1000)
	`
		const actor = createActor(
			createProcessMachine((_input, report) => {
				const resource = native(script, (event) => {
					if (event.type === 'STDERR') {
						const pid = event.text.match(/DESCENDANT_READY:(\d+)/)?.[1]
						if (pid) {
							descendant = Number(pid)
							ready = true
						}
					}
					if (event.type === 'CLOSE') closed = true
					report(event)
				})
				port = resource
				return {
					...resource,
					signal: (value) => {
						signals.push(value)
						resource.signal(value)
					}
				}
			}),
			{ clock, input: { command: 'fixture', env: {} } }
		).start()
		try {
			await eventually(() => expect(ready).toBe(true))
			actor.send({ type: 'CANCEL' })
			await eventually(() => expect(closed).toBe(true))
			expect(port?.isAlive()).toBe(true)
			expect(actor.getSnapshot().status).toBe('active')
			clock.increment(5000)
			expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
			await eventually(() => {
				clock.increment(100)
				expect(actor.getSnapshot().status).toBe('done')
			})
			expect(await toPromise(actor)).toMatchObject({
				outcome: 'cancelled',
				startFailed: false,
				signalFailed: false
			})
			expect(port?.isAlive()).toBe(false)
		} finally {
			actor.stop()
			// Independent fixture cleanup also protects the regression's failure path.
			stopDescendant(descendant)
		}
	}
)
it('detaches safely before an asynchronous native spawn error arrives', async () => {
	const events: ProcessEvent[] = []
	const port = openNodeProcess(
		{ file: '/nonexistent/clipper-process-fixture', args: [], env: {}, stderr: 'pipe' },
		(event) => events.push(event)
	)
	port.release()
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(events).toEqual([])
	expect(port.isAlive()).toBe(false)
})
