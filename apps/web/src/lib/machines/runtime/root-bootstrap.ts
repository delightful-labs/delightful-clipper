import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic, matchesState } from 'xstate'

import type { RootAccess, RootWrite } from '../../contracts/account.js'

type Result =
	| { outcome: 'ready'; write?: RootWrite }
	| { outcome: 'failed' | 'conflict' | 'closed' }
type Context = { root: RootAccess; write: RootWrite | undefined; result: Result }
function receipt(context: Context) {
	if (!context.write) throw new Error('Missing library write receipt')
	return context.write
}
const actors = {
	read: createAsyncLogic({ run: ({ input }: { input: RootAccess }) => input.read() }),
	issue: createAsyncLogic({ run: async ({ input }: { input: RootAccess }) => input.ensure() }),
	persist: createAsyncLogic({ run: ({ input }: { input: RootWrite }) => input.local() })
}
// The write region retains both issue and local settlement when shutdown is requested.
export const rootBootstrapMachine = setup({
	schemas: {
		context: types<Context>(),
		events: { SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>() },
		input: types<RootAccess>(),
		output: types<Result>(),
		tags: types<string>(),
		children: {
			read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
			issue: types<import('xstate').ActorRefFrom<(typeof actors)['issue']>>(),
			persist: types<import('xstate').ActorRefFrom<(typeof actors)['persist']>>()
		}
	},
	actors,
	guards: {
		stopping: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ writing: { lifetime: 'stopping' } }, value),
		existingRoot: (_args: { context: Context }, { result }: { result: string }) =>
			result === 'compatible',
		incompatibleRoot: (_args: { context: Context }, { result }: { result: string }) =>
			result === 'incompatible'
	}
}).createMachine({
	id: 'root-bootstrap',
	initial: 'reading',
	context: ({ input }) => ({
		root: input,
		write: undefined,
		result: { outcome: 'failed' }
	}),
	output: ({ context }) => context.result,
	states: {
		reading: {
			on: { SHUTDOWN: { target: 'closed' } },
			invoke: {
				id: 'read',
				src: 'read',
				input: ({ context }: { context: Context }) => context.root,
				onDone: (args) => {
					const { event } = args
					if (args.guards.incompatibleRoot(args, { result: event.output })) {
						return { target: 'conflict' }
					}
					if (args.guards.existingRoot(args, { result: event.output })) {
						return { target: 'existing' }
					}
					return { target: 'writing' }
				},
				onError: { target: 'failed' }
			}
		},
		writing: {
			type: 'parallel',
			states: {
				lifetime: {
					initial: 'active',
					states: {
						active: { on: { SHUTDOWN: { target: 'stopping' } } },
						stopping: { on: { SHUTDOWN: {} } }
					}
				},
				operation: {
					initial: 'issuing',
					states: {
						issuing: {
							invoke: {
								id: 'issue',
								src: 'issue',
								input: ({ context }: { context: Context }) => context.root,
								onDone: (args) => {
									return { target: 'persisting', context: { write: args.event.output } }
								},
								onError: (args) => {
									if (matchesState({ writing: { lifetime: 'stopping' } }, args.value)) {
										return { target: '#root-bootstrap.closed' }
									}
									return { target: '#root-bootstrap.failed' }
								}
							}
						},
						persisting: {
							invoke: {
								id: 'persist',
								src: 'persist',
								input: ({ context }: { context: Context }) => receipt(context),
								onDone: (args) => {
									if (matchesState({ writing: { lifetime: 'stopping' } }, args.value)) {
										return { target: '#root-bootstrap.closed' }
									}
									return { target: '#root-bootstrap.ready' }
								},
								onError: (args) => {
									if (matchesState({ writing: { lifetime: 'stopping' } }, args.value)) {
										return { target: '#root-bootstrap.closed' }
									}
									return { target: '#root-bootstrap.failed' }
								}
							}
						}
					}
				}
			}
		},
		ready: {
			type: 'final',
			entry: (args) => {
				const { context } = args
				return { context: { result: { outcome: 'ready', write: receipt(context) } } }
			}
		},
		existing: {
			type: 'final',
			entry: () => {
				return { context: { result: { outcome: 'ready' } } }
			}
		},
		failed: { type: 'final' },
		conflict: {
			type: 'final',
			entry: () => {
				return { context: { result: { outcome: 'conflict' } } }
			}
		},
		closed: {
			type: 'final',
			entry: () => {
				return { context: { result: { outcome: 'closed' } } }
			}
		}
	}
})
