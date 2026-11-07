import { assign, fromCallback, fromPromise, raise, sendTo, setup } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { Session } from '../../backend/jazz/account.js'
import type { SessionOwnerReply } from 'delightful-local-first/session/contracts'
import type { AccountInput } from '../../contracts/account.js'
import { createApplicationReadinessMachine } from '../../machines/runtime/application-readiness.js'
import { observeBrowserConnection } from '../../offline/browser.js'

const application = createApplicationReadinessMachine<Session>(observeBrowserConnection)
type Input = AccountInput<Session>
type Context = { input: Input; session: Session | undefined }
type Event =
	| { type: 'SHUTDOWN' }
	| {
			type: 'ACCOUNT'
			event: { type: 'CREATE' | 'LOGOUT' | 'RETRY' } | { type: 'RESTORE'; phrase: string }
	  }
	| { type: 'OWNER_READY'; session: Session }
	| { type: 'OWNER_EMPTY' }
	| { type: 'APPLICATION_CLOSED'; clean: boolean }
const owner = fromCallback<SessionOwnerReply<Session>, Input>(
	({ input, self, receive, sendBack }) => {
		const scope = { binding: input.startup.scope.binding, attachment: {}, generation: 0 }
		receive((event) => {
			if (event.type === 'ACQUIRED') sendBack({ type: 'OWNER_READY', session: event.session })
			else if (event.type === 'ACQUISITION_FAILED') sendBack({ type: 'OWNER_EMPTY' })
		})
		input.startup.owner.send({ type: 'ACQUIRE', scope, replyTo: self })
		return () => input.startup.owner.send({ type: 'RELEASE', scope, replyTo: self })
	}
)
const actors = {
	application,
	owner,
	close: fromPromise(({ input }: { input: Session }) => input.close())
}

/** Realm owner. Application detach drains domain work first; then wait for a
 * pending DLF acquisition and close its actual SDK session before releasing ports.
 * A failed drain never acknowledges safe worker termination. */
export const workerHostMachine = setup<
	Context,
	Event,
	typeof actors,
	{ application: 'application' },
	{ reportApplicationClosed: undefined },
	{ applicationDrained: undefined },
	never,
	string,
	Input
>({
	actors,
	guards: {
		applicationDrained: ({ event }) => event.type === 'APPLICATION_CLOSED' && event.clean
	},
	actions: {
		reportApplicationClosed: raise(({ self }) => ({
			type: 'APPLICATION_CLOSED',
			clean: self.getSnapshot().children.application?.getSnapshot().matches('closed') === true
		}))
	}
}).createMachine({
	id: 'worker-host',
	initial: 'running',
	context: ({ input }) => ({ input, session: undefined }),
	states: {
		running: {
			initial: 'accepting',
			on: {
				APPLICATION_CLOSED: [
					{ guard: 'applicationDrained', target: 'settlingAcquisition' },
					{ target: 'failed' }
				]
			},
			invoke: {
				id: 'application',
				src: 'application',
				input: ({ context }) => context.input,
				onDone: { actions: 'reportApplicationClosed' },
				onError: 'failed'
			},
			states: {
				accepting: {
					on: {
						ACCOUNT: { actions: sendTo('application', ({ event }) => event.event) },
						SHUTDOWN: { target: 'draining', actions: sendTo('application', { type: 'SHUTDOWN' }) }
					}
				},
				draining: {}
			}
		},
		settlingAcquisition: {
			invoke: { src: 'owner', input: ({ context }) => context.input },
			on: {
				OWNER_READY: {
					target: 'closingSession',
					actions: assign({ session: ({ event }) => event.session })
				},
				OWNER_EMPTY: 'closed'
			}
		},
		closingSession: {
			invoke: {
				src: 'close',
				input: ({ context }) => {
					if (!context.session) throw new Error('Worker session unavailable')
					return context.session
				},
				onDone: 'closed',
				onError: 'failed'
			}
		},
		closed: {
			type: 'final',
			entry: [({ context }) => context.input.startup.owner.stop(), assign({ session: undefined })]
		},
		failed: {}
	}
})
export type WorkerHost = ActorRefFrom<typeof workerHostMachine>
