import { assign, setup } from 'xstate'
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
const admissionModel = setup<Context, Event>({}).extend({
	actions: {
		resetWindow: assign(({ context }) => ({
			owners: {
				...context.owners,
				[request(context).owner]: {
					start: request(context).now,
					count: 0,
					active: owner(context)?.active ?? 0
				}
			}
		})),
		openWindow: assign(({ context }) => ({
			owners: {
				...context.owners,
				[request(context).owner]: { start: request(context).now, count: 0, active: 0 }
			}
		})),
		grantLease: assign(({ context }) => {
			const value = owner(context)
			if (!value) throw new Error('Missing quota window')
			return {
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
		}),
		replyGranted: ({ context }) => request(context).reply(context.sequence),
		denyLease: ({ context }) => request(context).reply(undefined),
		clearRequest: assign({ request: undefined })
	}
})
export const captureAdmissionMachine = admissionModel.createMachine({
	id: 'capture-admission',
	context: { owners: {}, leases: {}, sequence: 0, request: undefined },
	initial: 'accepting',
	states: {
		accepting: {
			on: {
				ACQUIRE: {
					target: 'checking',
					actions: assign({
						request: ({ event }) => ({ owner: event.owner, now: event.now, reply: event.reply })
					})
				},
				RELEASE: {
					guard: ({ context, event }) => context.leases[event.lease] !== undefined,
					actions: assign(({ context, event }) => {
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
					})
				}
			}
		},
		checking: {
			entry: assign(({ context }) => ({
				owners: Object.fromEntries(
					Object.entries(context.owners).filter(
						([, value]) => value.active !== 0 || request(context).now - value.start < 60000
					)
				)
			})),
			always: [
				{
					guard: ({ context }) => Object.keys(context.leases).length >= 4,
					target: 'accepting',
					actions: ['denyLease', 'clearRequest']
				},
				{
					guard: ({ context }) => !owner(context) && Object.keys(context.owners).length >= 1024,
					target: 'accepting',
					actions: ['denyLease', 'clearRequest']
				},
				{ guard: ({ context }) => !owner(context), target: 'checkingOwner', actions: 'openWindow' },
				{
					guard: ({ context }) => request(context).now - (owner(context)?.start ?? 0) >= 60000,
					target: 'checkingOwner',
					actions: 'resetWindow'
				},
				{ target: 'checkingOwner' }
			]
		},
		checkingOwner: {
			always: [
				{
					guard: ({ context }) =>
						(owner(context)?.active ?? 0) >= 2 || (owner(context)?.count ?? 0) >= 20,
					target: 'accepting',
					actions: ['denyLease', 'clearRequest']
				},
				{
					target: 'accepting',
					actions: ['grantLease', 'replyGranted', 'clearRequest']
				}
			]
		}
	}
})
