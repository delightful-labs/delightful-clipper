import { assign, fromPromise, setup, stateIn } from 'xstate'

export type PreviewJazzApp = { appId: string; adminSecret: string }
export type PreviewBuildResult =
	| { outcome: 'succeeded'; appId: string }
	| { outcome: 'refused' }
	| { outcome: 'failed'; stage: 'provisioning' }
	| { outcome: 'partial'; stage: 'waitingForApp' | 'deploying' | 'building'; appId: string }
	| { outcome: 'cancelled' }

type Input = {
	context: string | undefined
	provision: (signal: AbortSignal) => Promise<PreviewJazzApp>
	waitForApp: (app: PreviewJazzApp, signal: AbortSignal) => Promise<'ready' | 'pending'>
	deploy: (app: PreviewJazzApp, signal: AbortSignal) => Promise<void>
	build: (appId: string, signal: AbortSignal) => Promise<void>
}
type Context = Input & {
	routingChecks: number
	controller: AbortController
	credentials: PreviewJazzApp | undefined
	appId: string | undefined
	result: PreviewBuildResult | undefined
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing preview build dependency')
	return value
}

const provision = fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
	input.provision(AbortSignal.any([signal, input.controller.signal]))
)
const waitForApp = fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
	input.waitForApp(required(input.credentials), AbortSignal.any([signal, input.controller.signal]))
)
const deploy = fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
	input.deploy(required(input.credentials), AbortSignal.any([signal, input.controller.signal]))
)
const build = fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
	input.build(required(input.appId), AbortSignal.any([signal, input.controller.signal]))
)

// Keep the operation invoked until its abort/child-process close has settled.
const operationStates = {
	running: { on: { CANCEL: 'cancelling' } },
	cancelling: {
		entry: ({ context }: { context: Context }) => context.controller.abort(),
		on: { CANCEL: {} }
	}
}

export const jazzPreviewBuild = setup<
	Context,
	{ type: 'CANCEL' },
	{
		provision: typeof provision
		waitForApp: typeof waitForApp
		deploy: typeof deploy
		build: typeof build
	},
	{},
	{},
	{
		provisionCancelled: undefined
		readinessCancelled: undefined
		deployCancelled: undefined
		buildCancelled: undefined
	},
	never,
	string,
	Input,
	PreviewBuildResult
>({
	actors: { provision, waitForApp, deploy, build },
	guards: {
		provisionCancelled: stateIn('#jazz-preview-build.provisioning.cancelling'),
		readinessCancelled: stateIn('#jazz-preview-build.waitingForApp.cancelling'),
		deployCancelled: stateIn('#jazz-preview-build.deploying.cancelling'),
		buildCancelled: stateIn('#jazz-preview-build.building.cancelling')
	}
}).createMachine({
	id: 'jazz-preview-build',
	context: ({ input }) => ({
		...input,
		controller: new AbortController(),
		routingChecks: 0,
		credentials: undefined,
		appId: undefined,
		result: undefined
	}),
	initial: 'checkingContext',
	output: ({ context }) => required(context.result),
	states: {
		checkingContext: {
			always: [
				{ guard: ({ context }) => context.context === 'deploy-preview', target: 'provisioning' },
				{ target: 'refused' }
			]
		},
		provisioning: {
			initial: 'running',
			states: operationStates,
			invoke: {
				src: 'provision',
				input: ({ context }) => context,
				onDone: [
					{ guard: 'provisionCancelled', target: 'cancelled' },
					{
						target: 'waitingForApp',
						actions: assign({
							credentials: ({ event }) => event.output,
							appId: ({ event }) => event.output.appId
						})
					}
				],
				onError: [{ guard: 'provisionCancelled', target: 'cancelled' }, { target: 'failed' }]
			}
		},
		waitingForApp: {
			initial: 'running',
			states: operationStates,
			entry: assign({ routingChecks: ({ context }) => context.routingChecks + 1 }),
			invoke: {
				src: 'waitForApp',
				input: ({ context }) => context,
				onDone: [
					{ guard: 'readinessCancelled', target: 'cancelled' },
					{ guard: ({ event }) => event.output === 'ready', target: 'deploying' },
					{ guard: ({ context }) => context.routingChecks < 12, target: 'routingDelay' },
					{ target: 'readinessFailed' }
				],
				onError: [
					{ guard: 'readinessCancelled', target: 'cancelled' },
					{ target: 'readinessFailed' }
				]
			}
		},
		routingDelay: {
			after: { 5000: 'waitingForApp' },
			on: { CANCEL: 'cancelled' }
		},
		deploying: {
			initial: 'running',
			states: operationStates,
			invoke: {
				src: 'deploy',
				input: ({ context }) => context,
				onDone: [
					{ guard: 'deployCancelled', target: 'cancelled' },
					{ target: 'building', actions: assign({ credentials: undefined }) }
				],
				onError: [{ guard: 'deployCancelled', target: 'cancelled' }, { target: 'deploymentFailed' }]
			}
		},
		building: {
			initial: 'running',
			states: operationStates,
			invoke: {
				src: 'build',
				input: ({ context }) => context,
				onDone: [{ guard: 'buildCancelled', target: 'cancelled' }, { target: 'succeeded' }],
				onError: [{ guard: 'buildCancelled', target: 'cancelled' }, { target: 'buildFailed' }]
			}
		},
		succeeded: {
			type: 'final',
			entry: assign({
				result: ({ context }): PreviewBuildResult => ({
					outcome: 'succeeded',
					appId: required(context.appId)
				})
			})
		},
		refused: {
			type: 'final',
			entry: assign({ result: (): PreviewBuildResult => ({ outcome: 'refused' }) })
		},
		failed: {
			type: 'final',
			entry: assign({
				result: (): PreviewBuildResult => ({ outcome: 'failed', stage: 'provisioning' })
			})
		},
		readinessFailed: {
			type: 'final',
			entry: assign({
				credentials: undefined,
				result: ({ context }): PreviewBuildResult => ({
					outcome: 'partial',
					stage: 'waitingForApp',
					appId: required(context.appId)
				})
			})
		},
		deploymentFailed: {
			type: 'final',
			entry: assign({
				credentials: undefined,
				result: ({ context }): PreviewBuildResult => ({
					outcome: 'partial',
					stage: 'deploying',
					appId: required(context.appId)
				})
			})
		},
		buildFailed: {
			type: 'final',
			entry: assign({
				result: ({ context }): PreviewBuildResult => ({
					outcome: 'partial',
					stage: 'building',
					appId: required(context.appId)
				})
			})
		},
		cancelled: {
			type: 'final',
			entry: assign({
				credentials: undefined,
				result: (): PreviewBuildResult => ({ outcome: 'cancelled' })
			})
		}
	}
})
