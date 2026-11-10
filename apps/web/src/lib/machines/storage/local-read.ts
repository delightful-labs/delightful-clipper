import { createAsyncLogic, createCallbackLogic, setup, types } from 'xstate'
import type { ReadCapabilities } from '../../contracts/storage.js'

type Input<Row> = Pick<ReadCapabilities, 'isCurrent' | 'observeConnection'> & {
	read: (signal: AbortSignal) => Promise<Row | null>
}
type ConnectionEvent = {
	type: 'CONNECTION'
	state: import('jazz-tools').LinkStatus['state']
}

/** A local miss during startup is provisional. Cached rows never await the link. */
export function createLocalReadMachine<Row>() {
	type Context = Input<Row> & { result: { row: Row | null } }
	const actors = {
		read: createAsyncLogic({
			run: ({ input, signal }: { input: Input<Row>; signal: AbortSignal }) => input.read(signal)
		}),
		connection: createCallbackLogic<never, Input<Row>>(({ input, sendBack }) =>
			input.observeConnection?.((state) => sendBack({ type: 'CONNECTION', state }))
		)
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			input: types<Input<Row>>(),
			output: types<{ row: Row | null }>(),
			events: { CONNECTION: types<Omit<ConnectionEvent, 'type'>>() },
			children: {
				read: types<import('xstate').ActorRefFrom<typeof actors.read>>(),
				connection: types<import('xstate').ActorRefFrom<typeof actors.connection>>()
			}
		},
		actors,
		guards: {
			hasRow: (_: unknown, { row }: { row: Row | null }) => row !== null,
			canObserveConnection: ({ context }: { context: Context }) =>
				context.observeConnection !== undefined,
			scopeLost: ({ context }: { context: Context }) => !context.isCurrent(),
			connecting: (_: unknown, { state }: ConnectionEvent) => state === 'connecting',
			connected: (_: unknown, { state }: ConnectionEvent) => state === 'connected'
		}
	})
	const input = ({ context }: { context: Context }) => context
	return model.createMachine({
		initial: 'reading',
		context: ({ input }) => ({ ...input, result: { row: null } }),
		output: ({ context }) => context.result,
		states: {
			reading: {
				invoke: {
					id: 'read',
					src: 'read',
					input,
					onDone: (args) => {
						if (args.guards.hasRow(args, { row: args.event.output }))
							return { target: 'found', context: { result: { row: args.event.output } } }
						if (args.guards.canObserveConnection(args)) return { target: 'waiting' }
						return { target: 'absent' }
					}
				}
			},
			waiting: {
				invoke: { id: 'connection', src: 'connection', input },
				on: {
					CONNECTION: (args) => {
						if (args.guards.scopeLost(args)) return { target: 'absent' }
						if (args.guards.connecting(args, args.event)) return {}
						if (args.guards.connected(args, args.event)) return { target: 'rereading' }
						return { target: 'absent' }
					}
				}
			},
			// A separate state bounds the retry, including when connection completed
			// between the original query and subscription admission.
			rereading: {
				invoke: {
					id: 'read',
					src: 'read',
					input,
					onDone: (args) => {
						if (args.guards.hasRow(args, { row: args.event.output }))
							return { target: 'found', context: { result: { row: args.event.output } } }
						return { target: 'absent' }
					}
				}
			},
			found: { type: 'final' },
			absent: { type: 'final' }
		}
	})
}
