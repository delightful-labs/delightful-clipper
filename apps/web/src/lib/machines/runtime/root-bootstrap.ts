import { assign, fromPromise, setup, stateIn } from 'xstate'
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
	read: fromPromise(({ input }: { input: RootAccess }) => input.read()),
	issue: fromPromise(async ({ input }: { input: RootAccess }) => input.ensure()),
	persist: fromPromise(({ input }: { input: RootWrite }) => input.local())
}
// The write region retains both issue and local settlement when shutdown is requested.
export const rootBootstrapMachine = setup<
	Context,
	{ type: 'SHUTDOWN' },
	typeof actors,
	{},
	{},
	{ stopping: undefined; existingRoot: { result: string }; incompatibleRoot: { result: string } },
	never,
	string,
	RootAccess,
	Result
>({
	actors,
	guards: {
		stopping: stateIn({ writing: { lifetime: 'stopping' } }),
		existingRoot: (_args, { result }) => result === 'compatible',
		incompatibleRoot: (_args, { result }) => result === 'incompatible'
	}
}).createMachine({
	id: 'root-bootstrap',
	initial: 'reading',
	context: ({ input }) => ({ root: input, write: undefined, result: { outcome: 'failed' } }),
	output: ({ context }) => context.result,
	states: {
		reading: {
			on: { SHUTDOWN: 'closed' },
			invoke: {
				src: 'read',
				input: ({ context }) => context.root,
				onDone: [
					{
						guard: { type: 'incompatibleRoot', params: ({ event }) => ({ result: event.output }) },
						target: 'conflict'
					},
					{
						guard: { type: 'existingRoot', params: ({ event }) => ({ result: event.output }) },
						target: 'existing'
					},
					{ target: 'writing' }
				],
				onError: 'failed'
			}
		},
		writing: {
			type: 'parallel',
			states: {
				lifetime: {
					initial: 'active',
					states: { active: { on: { SHUTDOWN: 'stopping' } }, stopping: { on: { SHUTDOWN: {} } } }
				},
				operation: {
					initial: 'issuing',
					states: {
						issuing: {
							invoke: {
								src: 'issue',
								input: ({ context }) => context.root,
								onDone: {
									target: 'persisting',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: [
									{ guard: 'stopping', target: '#root-bootstrap.closed' },
									{ target: '#root-bootstrap.failed' }
								]
							}
						},
						persisting: {
							invoke: {
								src: 'persist',
								input: ({ context }) => receipt(context),
								onDone: [
									{ guard: 'stopping', target: '#root-bootstrap.closed' },
									{ target: '#root-bootstrap.ready' }
								],
								onError: [
									{ guard: 'stopping', target: '#root-bootstrap.closed' },
									{ target: '#root-bootstrap.failed' }
								]
							}
						}
					}
				}
			}
		},
		ready: {
			type: 'final',
			entry: assign({ result: ({ context }) => ({ outcome: 'ready', write: receipt(context) }) })
		},
		existing: { type: 'final', entry: assign({ result: { outcome: 'ready' } }) },
		failed: { type: 'final' },
		conflict: { type: 'final', entry: assign({ result: { outcome: 'conflict' } }) },
		closed: { type: 'final', entry: assign({ result: { outcome: 'closed' } }) }
	}
})
