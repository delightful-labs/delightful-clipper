import {
	createAsyncLogic,
	createCallbackLogic,
	setup,
	types,
	type ActorRefFrom,
	type ActorRef,
	type Snapshot
} from 'xstate'
import type { LibraryEvent } from '../../contracts/library.js'
import { remoteReaderSurface } from './reader-surface.js'

type Surface = ReturnType<typeof remoteReaderSurface>
type Input = {
	id: string
	port: MessagePort
	fullscreen: { supported: boolean; active: boolean }
	library: ActorRef<Snapshot<unknown>, LibraryEvent> | undefined
	documentId: string
	sources: string[]
	deadlineMs: number
	onOverdue: () => void
	onBlocked?: () => void
}
type Context = { input: Input; surface: Surface | undefined }
function required(value: Surface | undefined) {
	if (!value) throw new Error('Reader surface unavailable')
	return value
}
const resource = createCallbackLogic<never, Input>(({ input, sendBack }) => {
	const surface = remoteReaderSurface(input.port, input.fullscreen)
	const managed: Surface = {
		...surface,
		lifecycle: {
			accepted: () => sendBack({ type: 'ACCEPTED' }),
			released: () => sendBack({ type: 'RELEASED' })
		}
	}
	sendBack({ type: 'READY', surface: managed })
	return surface.dispose
})
const close = createAsyncLogic<void, Surface>({ run: ({ input }) => input.close() })
/** The host owns one finite lease per transferred DOM port. Reader release means
 * final position/fullscreen/write work settled; completion also awaits Window cleanup. */
export const readerSurfaceLeaseMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<Input>(),
		output: types<{ id: string }>(),
		events: {
			READY: types<{ surface: Surface }>(),
			ACCEPTED: types(),
			RELEASED: types(),
			SHUTDOWN: types()
		},
		children: {
			resource: types<ActorRefFrom<typeof resource>>(),
			close: types<ActorRefFrom<typeof close>>()
		}
	},
	actors: { resource, close },
	delays: { deadline: ({ context }) => context.input.deadlineMs },
	guards: { offered: ({ context }: { context: Context }) => context.input.library !== undefined }
}).createMachine({
	id: 'reader-surface-lease',
	context: ({ input }) => ({ input, surface: undefined }),
	initial: 'starting',
	output: ({ context }) => ({ id: context.input.id }),
	invoke: { id: 'resource', src: 'resource', input: ({ context }) => context.input },
	states: {
		starting: {
			on: {
				READY: (args) => ({
					target: args.guards.offered(args) ? 'offering' : 'closing',
					context: { surface: args.event.surface }
				}),
				SHUTDOWN: { target: 'stoppingStartup' }
			}
		},
		stoppingStartup: {
			on: { READY: ({ event }) => ({ target: 'closing', context: { surface: event.surface } }) }
		},
		offering: {
			entry: ({ context }, enq) => {
				if (!context.input.library) throw new Error('Library unavailable')
				enq.sendTo(context.input.library, {
					type: 'READER_EVENT',
					event: {
						type: 'ATTACH_SURFACE',
						surface: required(context.surface),
						documentId: context.input.documentId,
						sources: context.input.sources
					}
				})
			},
			timeout: 'deadline',
			onTimeout: { target: 'offerOverdue' },
			on: {
				ACCEPTED: { target: 'attached' },
				RELEASED: { target: 'closing' },
				SHUTDOWN: { target: 'retiring' }
			}
		},
		offerOverdue: {
			entry: ({ context }, enq) => enq(context.input.onOverdue),
			on: {
				ACCEPTED: { target: 'retiring' },
				RELEASED: { target: 'closing' },
				SHUTDOWN: { target: 'retiring' }
			}
		},
		attached: { on: { RELEASED: { target: 'closing' }, SHUTDOWN: { target: 'retiring' } } },
		retiring: {
			initial: 'waiting',
			entry: ({ context }, enq) => enq(required(context.surface).detach),
			on: { RELEASED: { target: 'closing' } },
			states: {
				waiting: { timeout: 'deadline', onTimeout: { target: 'overdue' } },
				overdue: { entry: ({ context }, enq) => enq(context.input.onOverdue) }
			}
		},
		closing: {
			initial: 'waiting',
			invoke: {
				id: 'close',
				src: 'close',
				input: ({ context }) => required(context.surface),
				onDone: { target: 'closed' },
				onError: { target: 'blocked' }
			},
			states: {
				waiting: { timeout: 'deadline', onTimeout: { target: 'overdue' } },
				overdue: { entry: ({ context }, enq) => enq(context.input.onOverdue) }
			}
		},
		blocked: {
			entry: ({ context }, enq) => enq(context.input.onBlocked ?? context.input.onOverdue)
		},
		closed: { type: 'final' }
	}
})
