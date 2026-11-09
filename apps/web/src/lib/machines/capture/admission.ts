import type { EventPayload } from '../events.js'
import { types, setup } from 'xstate'

type Owner = { start: number; count: number; active: number }
type Request = { owner: string; now: number; reply: (lease: number | undefined) => void }
type Context = {
	owners: Record<string, Owner>
	leases: Record<string, string>
	sequence: number
	request: Request | undefined
}
type Event = ({ type: 'ACQUIRE' } & Request) | { type: 'RELEASE'; lease: number }
function request(context: Context) {
	if (!context.request) throw new Error('Missing admission request')
	return context.request
}
function owner(context: Context) {
	const id = request(context).owner
	return Object.hasOwn(context.owners, id) ? context.owners[id] : undefined
}
/** Process-local bounded quota. Lease identity makes release idempotent. */
const admissionModel = setup({
	schemas: {
		context: types<Context>(),
		events: {
			ACQUIRE: types<EventPayload<Event, 'ACQUIRE'>>(),
			RELEASE: types<EventPayload<Event, 'RELEASE'>>()
		}
	},
	actions: {
		resetWindow: ({ context }: { context: Context }) => ({
			context: {
				owners: {
					...context.owners,
					[request(context).owner]: {
						start: request(context).now,
						count: 0,
						active: owner(context)?.active ?? 0
					}
				}
			}
		}),
		openWindow: ({ context }: { context: Context }) => ({
			context: {
				owners: {
					...context.owners,
					[request(context).owner]: { start: request(context).now, count: 0, active: 0 }
				}
			}
		}),
		grantLease: ({ context }: { context: Context }) => {
			const value = owner(context)
			if (!value) throw new Error('Missing quota window')
			return {
				context: {
					sequence: context.sequence + 1,
					leases: { ...context.leases, [context.sequence + 1]: request(context).owner },
					owners: {
						...context.owners,
						[request(context).owner]: {
							...value,
							active: value.active + 1,
							count: value.count + 1
						}
					}
				}
			}
		},
		replyGranted: ({ context }: { context: Context }) => request(context).reply(context.sequence),
		denyLease: ({ context }: { context: Context }) => request(context).reply(undefined),
		clearRequest: () => ({ context: { request: undefined } })
	}
})
export const captureAdmissionMachine = admissionModel.createMachine({
	id: 'capture-admission',
	context: { owners: {}, leases: {}, sequence: 0, request: undefined },
	initial: 'accepting',
	states: {
		accepting: {
			on: {
				ACQUIRE: (args) => {
					const { event } = args
					return {
						target: 'checking',
						context: { request: { owner: event.owner, now: event.now, reply: event.reply } }
					}
				},
				RELEASE: (args) => {
					const { context, event } = args
					if (!(context.leases[event.lease] !== undefined)) return
					return {
						context: (({ context, event }) => {
							const id = context.leases[event.lease]
							if (id === undefined || !context.owners[id])
								throw new Error('Missing active lease owner')
							return {
								leases: Object.fromEntries(
									Object.entries(context.leases).filter(([lease]) => lease !== String(event.lease))
								),
								owners: {
									...context.owners,
									[id]: { ...context.owners[id], active: context.owners[id].active - 1 }
								}
							}
						})(args)
					}
				}
			}
		},
		checking: {
			entry: (args) => {
				const { context } = args
				return {
					context: {
						owners: Object.fromEntries(
							Object.entries(context.owners).filter(
								([, value]) => value.active !== 0 || request(context).now - value.start < 60000
							)
						)
					}
				}
			},
			always: (args, enq) => {
				const { context } = args
				if (Object.keys(context.leases).length >= 4) {
					enq(args.actions.denyLease, args)
					return { target: 'accepting', context: args.actions.clearRequest().context }
				}
				if (!owner(context) && Object.keys(context.owners).length >= 1024) {
					enq(args.actions.denyLease, args)
					return { target: 'accepting', context: args.actions.clearRequest().context }
				}
				if (!owner(context)) {
					return { target: 'checkingOwner', context: args.actions.openWindow(args).context }
				}
				if (request(context).now - (owner(context)?.start ?? 0) >= 60000) {
					return { target: 'checkingOwner', context: args.actions.resetWindow(args).context }
				}
				return { target: 'checkingOwner' }
			}
		},
		checkingOwner: {
			always: (args, enq) => {
				const { context } = args
				if ((owner(context)?.active ?? 0) >= 2 || (owner(context)?.count ?? 0) >= 20) {
					enq(args.actions.denyLease, args)
					return { target: 'accepting', context: args.actions.clearRequest().context }
				}
				{
					let context = args.context
					let patch = {}
					patch = { ...patch, ...args.actions.grantLease(args).context }
					context = { ...args.context, ...patch }
					enq(args.actions.replyGranted, { ...args, context })
					patch = { ...patch, ...args.actions.clearRequest().context }
					context = { ...args.context, ...patch }
					return { target: 'accepting', context: patch }
				}
			}
		}
	}
})
