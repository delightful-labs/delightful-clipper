import { assign, fromCallback, sendTo, setup, stateIn } from 'xstate'
import { appendDiagnostic, deploymentHttpStatus } from './process-diagnostics.ts'
export type ProcessInput = { command: string; env: NodeJS.ProcessEnv }
export type ProcessEvent =
	| { type: 'CLOSE'; code: number | null }
	| { type: 'STDERR'; text: string }
	| {
			type:
				| 'SPAWNED'
				| 'PROCESS_ERROR'
				| 'OPEN_FAILED'
				| 'CANCEL'
				| 'SIGNAL_FAILED'
				| 'SCOPE_PRESENT'
				| 'SCOPE_GONE'
				| 'SCOPE_CHECK_FAILED'
				| 'RELEASED'
				| 'RELEASE_FAILED'
	  }
export type ProcessResult = {
	outcome: 'succeeded' | 'failed' | 'cancelled'
	code: number | null
	startFailed: boolean
	signalFailed: boolean
	cleanupFailed: boolean
	httpStatus: string | undefined
}
export type ProcessPort = {
	signal: (signal: 'SIGTERM' | 'SIGKILL') => void
	isAlive: () => boolean
	release: () => void
}
export type ProcessOpen = (
	input: ProcessInput,
	report: (event: ProcessEvent) => void
) => ProcessPort
type Issue = 'spawn' | 'process' | 'signal' | 'scope' | 'release'
type Context = {
	input: ProcessInput | undefined
	close: { code: number | null } | undefined
	diagnostic: string
	issues: Issue[]
	result: ProcessResult | undefined
}
type Command = { type: 'SIGTERM' | 'SIGKILL' | 'CHECK_SCOPE' | 'RELEASE' }
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing process resource')
	return value
}
function result(context: Context, outcome: ProcessResult['outcome']): ProcessResult {
	return {
		outcome,
		code: context.close?.code ?? null,
		startFailed: context.issues.includes('spawn'),
		signalFailed: context.issues.includes('signal'),
		cleanupFailed: context.issues.includes('scope') || context.issues.includes('release'),
		httpStatus: deploymentHttpStatus(context.diagnostic)
	}
}
/** Own spawn confirmation, group termination, stdio close and explicit resource release. */
export function createProcessMachine(open: ProcessOpen) {
	const processActor = fromCallback<Command, ProcessInput>(({ input, sendBack, receive }) => {
		let port: ProcessPort | undefined
		try {
			port = open(input, sendBack)
		} catch {
			sendBack({ type: 'OPEN_FAILED' })
		}
		receive((event) => {
			if (event.type === 'RELEASE') {
				const owned = port
				port = undefined
				try {
					owned?.release()
					sendBack({ type: 'RELEASED' })
				} catch {
					sendBack({ type: 'RELEASE_FAILED' })
				}
				return
			}
			if (event.type === 'CHECK_SCOPE') {
				try {
					sendBack({ type: port?.isAlive() ? 'SCOPE_PRESENT' : 'SCOPE_GONE' })
				} catch {
					sendBack({ type: 'SCOPE_CHECK_FAILED' })
				}
				return
			}
			try {
				required(port).signal(event.type)
			} catch {
				sendBack({ type: 'SIGNAL_FAILED' })
			}
		})
		return () => {
			// Emergency parent stop is unconditional abort; graceful release consumes the handle above.
			const owned = port
			port = undefined
			if (!owned) return
			try {
				owned.signal('SIGKILL')
			} catch {
				/* Best-effort abort on forced actor disposal. */
			} finally {
				owned.release()
			}
		}
	})
	const model = setup<
		Context,
		ProcessEvent,
		{ process: typeof processActor },
		{},
		{ issue: { kind: Issue }; recordClose: undefined },
		{ cancelled: undefined },
		never,
		string,
		ProcessInput,
		ProcessResult
	>({
		actors: { process: processActor },
		guards: { cancelled: stateIn({ owning: { cancellation: 'requested' } }) },
		actions: {
			issue: assign(({ context }, { kind }) => ({
				issues: [...new Set([...context.issues, kind])]
			})),
			recordClose: assign({
				close: ({ event }) => {
					if (event.type !== 'CLOSE') throw new Error('Expected process close')
					return { code: event.code }
				}
			})
		}
	})
	const gone = [
		{
			guard: ({ context }: { context: Context }) => context.close !== undefined,
			target: '#process-lifecycle.releasing'
		},
		{ target: '#process-lifecycle.waitingForClose' }
	]
	const checkingScope = model.createStateConfig({
		entry: sendTo('process', { type: 'CHECK_SCOPE' }),
		on: {
			SCOPE_PRESENT: 'waiting',
			SCOPE_GONE: gone,
			SCOPE_CHECK_FAILED: {
				target: 'waiting',
				actions: { type: 'issue', params: { kind: 'scope' } }
			}
		}
	})
	const terminal = (outcome: ProcessResult['outcome']) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }) => result(context, outcome),
				input: undefined,
				diagnostic: '',
				close: undefined,
				issues: []
			})
		})
	return model.createMachine({
		id: 'preview-process',
		initial: 'owning',
		context: ({ input }) => ({
			input,
			close: undefined,
			diagnostic: '',
			issues: [],
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			owning: {
				type: 'parallel',
				invoke: { id: 'process', src: 'process', input: ({ context }) => required(context.input) },
				on: {
					STDERR: {
						actions: assign({
							diagnostic: ({ context, event }) => appendDiagnostic(context.diagnostic, event.text)
						})
					},
					SIGNAL_FAILED: { actions: { type: 'issue', params: { kind: 'signal' } } }
				},
				states: {
					cancellation: {
						initial: 'active',
						states: { active: { on: { CANCEL: 'requested' } }, requested: {} }
					},
					lifecycle: {
						id: 'process-lifecycle',
						initial: 'opening',
						on: {
							CLOSE: { actions: 'recordClose' },
							PROCESS_ERROR: { actions: { type: 'issue', params: { kind: 'process' } } }
						},
						states: {
							opening: {
								on: {
									SPAWNED: 'running',
									CANCEL: 'cancellingBeforeSpawn',
									OPEN_FAILED: {
										target: 'releasing',
										actions: { type: 'issue', params: { kind: 'spawn' } }
									},
									PROCESS_ERROR: {
										target: 'failedSpawn',
										actions: { type: 'issue', params: { kind: 'spawn' } }
									},
									CLOSE: {
										target: 'checkingAfterClose',
										actions: ['recordClose', { type: 'issue', params: { kind: 'spawn' } }]
									}
								}
							},
							cancellingBeforeSpawn: {
								on: {
									SPAWNED: 'terminating',
									OPEN_FAILED: {
										target: 'releasing',
										actions: { type: 'issue', params: { kind: 'spawn' } }
									},
									PROCESS_ERROR: {
										target: 'failedSpawn',
										actions: { type: 'issue', params: { kind: 'spawn' } }
									},
									CLOSE: {
										target: 'checkingAfterClose',
										actions: ['recordClose', { type: 'issue', params: { kind: 'spawn' } }]
									}
								}
							},
							failedSpawn: {
								on: { CLOSE: { target: 'checkingAfterClose', actions: 'recordClose' } }
							},
							running: {
								on: {
									CANCEL: 'terminating',
									CLOSE: { target: 'checkingAfterClose', actions: 'recordClose' },
									PROCESS_ERROR: {
										target: 'terminating',
										actions: { type: 'issue', params: { kind: 'process' } }
									}
								}
							},
							checkingAfterClose: {
								entry: sendTo('process', { type: 'CHECK_SCOPE' }),
								on: {
									SCOPE_GONE: 'releasing',
									SCOPE_PRESENT: 'terminating',
									SCOPE_CHECK_FAILED: {
										target: 'terminating',
										actions: { type: 'issue', params: { kind: 'scope' } }
									}
								}
							},
							terminating: {
								entry: sendTo('process', { type: 'SIGTERM' }),
								on: { CLOSE: { target: '.checking', actions: 'recordClose' } },
								after: { 5000: 'killing' },
								initial: 'checking',
								states: { checking: checkingScope, waiting: { after: { 100: 'checking' } } }
							},
							killing: {
								entry: sendTo('process', { type: 'SIGKILL' }),
								on: { CLOSE: { target: '.checking', actions: 'recordClose' } },
								initial: 'checking',
								states: { checking: checkingScope, waiting: { after: { 100: 'checking' } } }
							},
							waitingForClose: { on: { CLOSE: { target: 'releasing', actions: 'recordClose' } } },
							releasing: {
								entry: sendTo('process', { type: 'RELEASE' }),
								on: {
									RELEASED: 'selectingOutcome',
									RELEASE_FAILED: {
										target: 'selectingOutcome',
										actions: { type: 'issue', params: { kind: 'release' } }
									}
								}
							},
							selectingOutcome: {
								always: [
									{ guard: 'cancelled', target: '#preview-process.cancelled' },
									{
										guard: ({ context }) =>
											context.close?.code === 0 && context.issues.length === 0,
										target: '#preview-process.succeeded'
									},
									{ target: '#preview-process.failed' }
								]
							}
						}
					}
				}
			},
			succeeded: terminal('succeeded'),
			failed: terminal('failed'),
			cancelled: terminal('cancelled')
		}
	})
}
