import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { jazzPreviewBuild } from './preview-machine.js'

afterEach(() => vi.useRealTimers())
function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

const app = {
	appId: '77777777-7777-4777-8777-777777777777',
	adminSecret: 'PRIVATE_GENERATED_SECRET'
}
function dependencies() {
	return {
		context: 'deploy-preview',
		provision: vi.fn(async (_signal: AbortSignal) => app),
		waitForApp: vi.fn(
			async (_app: typeof app, _signal: AbortSignal): Promise<'ready' | 'pending'> => 'ready'
		),
		deploy: vi.fn(async (_app: typeof app, _signal: AbortSignal) => {}),
		build: vi.fn(async (_appId: string, _signal: AbortSignal) => {})
	}
}

it.each([undefined, 'production', 'branch-deploy', 'dev'])(
	'refuses context %s before any effects',
	async (context) => {
		const input = { ...dependencies(), context }
		const actor = createActor(jazzPreviewBuild, { input }).start()
		expect(await toPromise(actor)).toEqual({ outcome: 'refused' })
		expect(input.provision).not.toHaveBeenCalled()
		expect(input.deploy).not.toHaveBeenCalled()
		expect(input.build).not.toHaveBeenCalled()
	}
)

it('waits for schema deployment and releases its credentials before building', async () => {
	const input = dependencies()
	const deployment = deferred()
	const building = deferred()
	input.deploy.mockReturnValue(deployment.promise)
	input.build.mockReturnValue(building.promise)
	const actor = createActor(jazzPreviewBuild, { input }).start()
	await waitFor(actor, (snapshot) => snapshot.matches({ deploying: 'running' }))
	expect(input.deploy).toHaveBeenCalledWith(app, expect.any(AbortSignal))
	expect(input.build).not.toHaveBeenCalled()
	deployment.resolve()
	await waitFor(actor, (snapshot) => snapshot.matches({ building: 'running' }))
	expect(actor.getSnapshot().context.credentials).toBeUndefined()
	expect(input.build).toHaveBeenCalledExactlyOnceWith(app.appId, expect.any(AbortSignal))
	building.resolve()
	expect(await toPromise(actor)).toEqual({ outcome: 'succeeded', appId: app.appId })
	expect(JSON.stringify(actor.getSnapshot().context)).not.toContain(app.adminSecret)
})

it('does not retry provisioning or start a deployment after provisioning fails', async () => {
	const input = dependencies()
	input.provision.mockRejectedValue(new Error('PRIVATE_RESPONSE'))
	const actor = createActor(jazzPreviewBuild, { input }).start()
	expect(await toPromise(actor)).toEqual({ outcome: 'failed', stage: 'provisioning' })
	expect(input.provision).toHaveBeenCalledTimes(1)
	expect(input.deploy).not.toHaveBeenCalled()
	expect(input.build).not.toHaveBeenCalled()
	expect(JSON.stringify(actor.getSnapshot().context)).not.toContain('PRIVATE_RESPONSE')
})

it.each(['deploying', 'building'])('reports a partial result when %s fails', async (stage) => {
	const input = dependencies()
	if (stage === 'deploying') input.deploy.mockRejectedValue(new Error(app.adminSecret))
	else input.build.mockRejectedValue(new Error('PRIVATE_BUILD_ERROR'))
	const actor = createActor(jazzPreviewBuild, { input }).start()
	expect(await toPromise(actor)).toEqual({ outcome: 'partial', stage, appId: app.appId })
	expect(actor.getSnapshot().context.credentials).toBeUndefined()
	expect(JSON.stringify(actor.getSnapshot().context)).not.toContain(app.adminSecret)
	if (stage === 'deploying') expect(input.build).not.toHaveBeenCalled()
})

it.each(['provisioning', 'waitingForApp', 'deploying', 'building'])(
	'waits for %s cancellation settlement and ignores late success',
	async (stage) => {
		const input = dependencies()
		const settled = deferred()
		let operationSignal: AbortSignal | undefined
		if (stage === 'provisioning')
			input.provision.mockImplementation(async (signal) => {
				operationSignal = signal
				await settled.promise
				return app
			})
		if (stage === 'waitingForApp')
			input.waitForApp.mockImplementation(async (_app, signal) => {
				operationSignal = signal
				await settled.promise
				return 'ready'
			})
		if (stage === 'deploying')
			input.deploy.mockImplementation(async (_app, signal) => {
				operationSignal = signal
				await settled.promise
			})
		if (stage === 'building')
			input.build.mockImplementation(async (_appId, signal) => {
				operationSignal = signal
				await settled.promise
			})
		const actor = createActor(jazzPreviewBuild, { input }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ [stage]: 'running' }))
		actor.send({ type: 'CANCEL' })
		expect(operationSignal?.aborted).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		expect(actor.getSnapshot().matches({ [stage]: 'cancelling' })).toBe(true)
		settled.resolve()
		expect(await toPromise(actor)).toEqual({ outcome: 'cancelled' })
		expect(actor.getSnapshot().context.credentials).toBeUndefined()
		if (stage === 'provisioning') expect(input.deploy).not.toHaveBeenCalled()
		if (stage !== 'building') expect(input.build).not.toHaveBeenCalled()
	}
)

it('routes an aborted operation rejection to cancelled instead of a failure', async () => {
	const input = dependencies()
	input.provision.mockImplementation(
		(signal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
			})
	)
	const actor = createActor(jazzPreviewBuild, { input }).start()
	actor.send({ type: 'CANCEL' })
	expect(await toPromise(actor)).toEqual({ outcome: 'cancelled' })
	expect(input.deploy).not.toHaveBeenCalled()
})

it('waits for cloud propagation without provisioning another app', async () => {
	vi.useFakeTimers()
	const input = dependencies()
	input.waitForApp
		.mockResolvedValueOnce('pending')
		.mockResolvedValueOnce('pending')
		.mockResolvedValue('ready')
	const actor = createActor(jazzPreviewBuild, { input }).start()
	await vi.runAllTimersAsync()
	expect(await toPromise(actor)).toEqual({ outcome: 'succeeded', appId: app.appId })
	expect(input.provision).toHaveBeenCalledTimes(1)
	expect(input.waitForApp).toHaveBeenCalledTimes(3)
	expect(input.deploy).toHaveBeenCalledTimes(1)
})

it('bounds readiness attempts and clears credentials when cloud routing never becomes ready', async () => {
	vi.useFakeTimers()
	const input = dependencies()
	input.waitForApp.mockResolvedValue('pending')
	const actor = createActor(jazzPreviewBuild, { input }).start()
	await vi.runAllTimersAsync()
	expect(await toPromise(actor)).toEqual({
		outcome: 'partial',
		stage: 'waitingForApp',
		appId: app.appId
	})
	expect(input.provision).toHaveBeenCalledTimes(1)
	expect(input.waitForApp).toHaveBeenCalledTimes(12)
	expect(input.deploy).not.toHaveBeenCalled()
	expect(actor.getSnapshot().context.credentials).toBeUndefined()
})

it('cancels the readiness delay without issuing another request', async () => {
	vi.useFakeTimers()
	const input = dependencies()
	input.waitForApp.mockResolvedValue('pending')
	const actor = createActor(jazzPreviewBuild, { input }).start()
	await vi.advanceTimersByTimeAsync(0)
	expect(actor.getSnapshot().matches('routingDelay')).toBe(true)
	actor.send({ type: 'CANCEL' })
	await vi.runAllTimersAsync()
	expect(await toPromise(actor)).toEqual({ outcome: 'cancelled' })
	expect(input.waitForApp).toHaveBeenCalledTimes(1)
	expect(input.deploy).not.toHaveBeenCalled()
})
