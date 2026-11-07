import { assign, raise, sendTo, setup, type SnapshotFrom } from 'xstate'
import { atprotoMachine, atprotoInput, type AtprotoInput } from './atproto.js'
import {
	type TokenIdentityCommand,
	createApplicationReadinessMachine,
	selectApplicationView
} from './application-readiness.js'
import type { AccountInput } from '../../contracts/account.js'
import type { ConnectionObserver } from '../../contracts/connection.js'

// The owner keeps both actors alive through shutdown. Component lifetime cannot
// discard an admitted token command while its library drain or SDK call settles.
export function createAccountLifecycleMachine<Session extends object>(observe: ConnectionObserver) {
	const application = createApplicationReadinessMachine<Session>(observe)
	type Application = SnapshotFrom<typeof application>
	type Input = { account: AccountInput<Session>; oauth: Omit<AtprotoInput, 'dispatch'> }
	type Context = Input & { application?: Application }
	type Event =
		| TokenIdentityCommand
		| { type: 'BEGIN'; operation: 'connect' | 'sign-in'; handle: string }
		| { type: 'CREATE' | 'LOGOUT' | 'RETRY' | 'SHUTDOWN' | 'APPLICATION_CLOSED' | 'OAUTH_CLOSED' }
		| { type: 'RESTORE'; phrase: string }
	const actors = { application, oauth: atprotoMachine }
	return setup<
		Context,
		Event,
		typeof actors,
		{ application: 'application'; oauth: 'oauth' },
		{},
		{},
		never,
		string,
		Input
	>({
		actors
	}).createMachine({
		id: 'account-lifecycle',
		context: ({ input }) => ({ ...input }),
		initial: 'active',
		states: {
			active: {
				type: 'parallel',
				onDone: 'closed',
				on: {
					CONNECT_TOKEN: { actions: sendTo('application', ({ event }) => event) },
					SIGN_IN_TOKEN: { actions: sendTo('application', ({ event }) => event) }
				},
				invoke: [
					{
						id: 'application',
						src: 'application',
						input: ({ context }) => context.account,
						onSnapshot: [
							{
								guard: ({ event }) => selectApplicationView(event.snapshot, true).canTokenIdentity,
								actions: [
									assign(({ event }) => ({ application: event.snapshot })),
									sendTo('oauth', ({ event }) => ({
										type: 'RESUME' as const,
										accountId:
											event.snapshot.context.observation.status === 'ready'
												? event.snapshot.context.observation.accountId
												: ''
									}))
								]
							},
							{ actions: assign(({ event }) => ({ application: event.snapshot })) }
						],
						onDone: { actions: raise({ type: 'APPLICATION_CLOSED' }) },
						onError: {
							actions: [
								sendTo('oauth', { type: 'OWNER_FAILED' }),
								raise({ type: 'APPLICATION_CLOSED' })
							]
						}
					},
					{
						id: 'oauth',
						src: 'oauth',
						input: ({ context, self }) =>
							atprotoInput({ ...context.oauth, dispatch: (command) => self.send(command) }),
						onDone: { actions: raise({ type: 'OAUTH_CLOSED' }) },
						onError: {
							actions: [
								sendTo('application', { type: 'SHUTDOWN' }),
								raise({ type: 'OAUTH_CLOSED' })
							]
						}
					}
				],
				states: {
					commands: {
						initial: 'running',
						states: {
							running: {
								on: {
									APPLICATION_CLOSED: {
										target: 'stopping',
										actions: sendTo('oauth', { type: 'OWNER_FAILED' })
									},
									OAUTH_CLOSED: {
										target: 'stopping',
										actions: sendTo('application', { type: 'SHUTDOWN' })
									},
									BEGIN: {
										guard: ({ context }) =>
											selectApplicationView(context.application, true).canTokenIdentity,
										actions: sendTo('oauth', ({ context, event }) => ({
											type: 'BEGIN' as const,
											intent: {
												operation: event.operation,
												accountId:
													context.application?.context.observation.status === 'ready'
														? context.application.context.observation.accountId
														: ''
											},
											handle: event.handle
										}))
									},
									CREATE: { actions: sendTo('application', ({ event }) => event) },
									LOGOUT: { actions: sendTo('application', ({ event }) => event) },
									RETRY: { actions: sendTo('application', ({ event }) => event) },
									RESTORE: { actions: sendTo('application', ({ event }) => event) },
									SHUTDOWN: {
										target: 'stopping',
										actions: [
											sendTo('oauth', { type: 'SHUTDOWN' }),
											sendTo('application', { type: 'SHUTDOWN' })
										]
									}
								}
							},
							stopping: { type: 'final' }
						}
					},
					applicationLifetime: {
						initial: 'open',
						states: { open: { on: { APPLICATION_CLOSED: 'closed' } }, closed: { type: 'final' } }
					},
					oauthLifetime: {
						initial: 'open',
						states: { open: { on: { OAUTH_CLOSED: 'closed' } }, closed: { type: 'final' } }
					}
				}
			},
			closed: { type: 'final' }
		}
	})
}
