import {
	assertEvent,
	assign,
	fromCallback,
	sendTo,
	setup,
	stateIn,
	raise,
	and,
	enqueueActions
} from 'xstate'
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
				| 'SPAWN_FAILED'
				| 'RUNTIME_FAILED'
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
type Context = {
	input: ProcessInput | undefined
	code: number | null
	diagnostic: string
	result: ProcessResult | undefined
}
type Command = { type: 'SIGTERM' | 'SIGKILL' | 'CHECK_SCOPE' | 'RELEASE' }
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing process resource')
	return value
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
		const commands: Record<Command['type'], () => void> = {
			RELEASE: () => {
				const owned = port
				port = undefined
				try {
					owned?.release()
					sendBack({ type: 'RELEASED' })
				} catch {
					sendBack({ type: 'RELEASE_FAILED' })
				}
			},
			CHECK_SCOPE: () => {
				try {
					sendBack({ type: required(port).isAlive() ? 'SCOPE_PRESENT' : 'SCOPE_GONE' })
				} catch {
					sendBack({ type: 'SCOPE_CHECK_FAILED' })
				}
			},
			SIGTERM: () => signal('SIGTERM'),
			SIGKILL: () => signal('SIGKILL')
		}
		function signal(value: 'SIGTERM' | 'SIGKILL') {
			try {
				required(port).signal(value)
			} catch {
				sendBack({ type: 'SIGNAL_FAILED' })
			}
		}
		receive((event) => commands[event.type]())
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
		{ recordClose: undefined; finish: { outcome: ProcessResult['outcome'] } },
		{
			cancelled: undefined
			closed: undefined
			successful: undefined
			spawnFailed: undefined
			signalFailed: undefined
			cleanupFailed: undefined
		},
		never,
		string,
		ProcessInput,
		ProcessResult
	>({
		actors: { process: processActor },
		guards: {
			spawnFailed: stateIn({ owning: { startup: 'failed' } }),
			signalFailed: stateIn({ owning: { signaling: 'failed' } }),
			cleanupFailed: stateIn({ owning: { cleanup: 'failed' } }),
			cancelled: stateIn({ owning: { cancellation: 'requested' } }),
			closed: stateIn({ owning: { completion: 'closed' } }),
			successful: and([
				stateIn({ owning: { completion: { closed: 'successful' } } }),
				stateIn({ owning: { startup: 'healthy' } }),
				stateIn({ owning: { runtime: 'healthy' } }),
				stateIn({ owning: { signaling: 'healthy' } }),
				stateIn({ owning: { cleanup: 'healthy' } })
			])
		},
		actions: {
			finish: enqueueActions(({ context, check, enqueue }, { outcome }) => {
				enqueue.assign({
					result: {
						outcome,
						code: context.code,
						httpStatus: deploymentHttpStatus(context.diagnostic),
						startFailed: check('spawnFailed'),
						signalFailed: check('signalFailed'),
						cleanupFailed: check('cleanupFailed')
					}
				})
			}),
			recordClose: assign({
				code: ({ event }) => {
					assertEvent(event, 'CLOSE')
					return event.code
				}
			})
		}
	})
	const gone = [
		{ guard: 'closed' as const, target: '#process-lifecycle.releasing' },
		{ target: '#process-lifecycle.waitingForClose' }
	]
	const checkingScope = model.createStateConfig({
		entry: sendTo('process', { type: 'CHECK_SCOPE' }),
		on: {
			SCOPE_PRESENT: 'waiting',
			SCOPE_GONE: gone,
			SCOPE_CHECK_FAILED: {
				target: 'waiting'
			}
		}
	})
	const terminal = model.createStateConfig({
		type: 'final',
		entry: assign({ input: undefined, diagnostic: '', code: null })
	})
	return model.createMachine({
		id: 'preview-process',
		initial: 'owning',
		context: ({ input }) => ({
			input,
			code: null,
			diagnostic: '',
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
					}
				},
				states: {
					cancellation: {
						initial: 'active',
						states: { active: { on: { CANCEL: 'requested' } }, requested: {} }
					},
					completion: {
						initial: 'pending',
						states: {
							pending: {
								on: {
									CLOSE: [
										{
											guard: ({ event }) => event.code === 0,
											target: 'closed.successful',
											actions: 'recordClose'
										},
										{ target: 'closed.unsuccessful', actions: 'recordClose' }
									]
								}
							},
							closed: { initial: 'unsuccessful', states: { successful: {}, unsuccessful: {} } }
						}
					},
					startup: {
						initial: 'healthy',
						states: { healthy: { on: { SPAWN_FAILED: 'failed' } }, failed: {} }
					},
					runtime: {
						initial: 'healthy',
						states: { healthy: { on: { RUNTIME_FAILED: 'failed' } }, failed: {} }
					},
					signaling: {
						initial: 'healthy',
						states: { healthy: { on: { SIGNAL_FAILED: 'failed' } }, failed: {} }
					},
					cleanup: {
						initial: 'healthy',
						states: {
							healthy: { on: { SCOPE_CHECK_FAILED: 'failed', RELEASE_FAILED: 'failed' } },
							failed: {}
						}
					},
					lifecycle: {
						id: 'process-lifecycle',
						initial: 'opening',
						on: {
							PROCESS_ERROR: { actions: raise({ type: 'RUNTIME_FAILED' }) }
						},
						states: {
							opening: {
								on: {
									SPAWNED: [{ guard: 'cancelled', target: 'terminating' }, { target: 'running' }],
									OPEN_FAILED: {
										target: 'releasing',
										actions: raise({ type: 'SPAWN_FAILED' })
									},
									PROCESS_ERROR: {
										target: 'failedSpawn',
										actions: raise({ type: 'SPAWN_FAILED' })
									},
									CLOSE: {
										target: 'checkingAfterClose',
										actions: raise({ type: 'SPAWN_FAILED' })
									}
								}
							},
							failedSpawn: {
								on: { CLOSE: { target: 'checkingAfterClose' } }
							},
							running: {
								on: {
									CANCEL: 'terminating',
									CLOSE: { target: 'checkingAfterClose' },
									PROCESS_ERROR: {
										target: 'terminating',
										actions: raise({ type: 'RUNTIME_FAILED' })
									}
								}
							},
							checkingAfterClose: {
								entry: sendTo('process', { type: 'CHECK_SCOPE' }),
								on: {
									SCOPE_GONE: 'releasing',
									SCOPE_PRESENT: 'terminating',
									SCOPE_CHECK_FAILED: {
										target: 'terminating'
									}
								}
							},
							terminating: {
								entry: sendTo('process', { type: 'SIGTERM' }),
								on: { CLOSE: { target: '.checking' } },
								after: { 5000: 'killing' },
								initial: 'checking',
								states: { checking: checkingScope, waiting: { after: { 100: 'checking' } } }
							},
							killing: {
								entry: sendTo('process', { type: 'SIGKILL' }),
								on: { CLOSE: { target: '.checking' } },
								initial: 'checking',
								states: { checking: checkingScope, waiting: { after: { 100: 'checking' } } }
							},
							waitingForClose: { on: { CLOSE: { target: 'releasing' } } },
							releasing: {
								entry: sendTo('process', { type: 'RELEASE' }),
								on: {
									RELEASED: 'selectingOutcome',
									RELEASE_FAILED: {
										target: 'selectingOutcome'
									}
								}
							},
							selectingOutcome: {
								always: [
									{
										guard: 'cancelled',
										target: '#preview-process.cancelled',
										actions: { type: 'finish', params: { outcome: 'cancelled' } }
									},
									{
										guard: 'successful',
										target: '#preview-process.succeeded',
										actions: { type: 'finish', params: { outcome: 'succeeded' } }
									},
									{
										target: '#preview-process.failed',
										actions: { type: 'finish', params: { outcome: 'failed' } }
									}
								]
							}
						}
					}
				}
			},
			succeeded: terminal,
			failed: terminal,
			cancelled: terminal
		}
	})
}
