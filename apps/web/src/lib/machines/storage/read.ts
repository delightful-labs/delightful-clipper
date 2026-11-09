import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic } from 'xstate'

import type {
	ArticleSource,
	DocumentHeader,
	ReadCapabilities,
	ReadInput,
	ReadOutcome,
	ReadResult,
	StoredAsset,
	TextSnapshot
} from '../../contracts/storage.js'
import {
	isValidAsset,
	isValidSource,
	isValidDocument,
	isValidSnapshot
} from '../../storage/integrity.js'
type Context = {
	id: string
	capability: ReadCapabilities | undefined
	generation: number
	reportTo: ReadInput['reportTo']
	document: DocumentHeader | undefined
	snapshot: TextSnapshot | undefined
	asset: StoredAsset | undefined
	source: ArticleSource | undefined
	result: ReadOutcome
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Incomplete record')
	return value
}
const clear = {
	id: '',
	capability: undefined,
	reportTo: undefined,
	document: undefined,
	snapshot: undefined,
	asset: undefined,
	source: undefined
}
function available(context: Context): ReadResult {
	if (!context.capability?.isCurrent()) return { kind: 'unavailable' as const }
	const document = required(context.document),
		snapshot = required(context.snapshot),
		asset = context.asset,
		source = context.source

	return {
		kind: 'available' as const,
		document,
		text: snapshot.text,
		asset: isValidAsset(asset, document)
			? { kind: 'available' as const, bytes: asset.payload, mediaType: asset.mediaType }
			: { kind: 'unavailable' as const, reason: asset ? 'invalid' : 'missing' },
		...(isValidSource(source, document) ? { source } : {})
	}
}
const actors = {
	document: createAsyncLogic({
		run: ({ input, signal }: { input: Context; signal: AbortSignal }) =>
			required(input.capability).document(input.id, signal)
	}),
	snapshot: createAsyncLogic({
		run: ({ input, signal }: { input: Context; signal: AbortSignal }) =>
			required(input.capability).snapshot(required(input.document).snapshotId, signal)
	}),
	asset: createAsyncLogic({
		run: ({ input, signal }: { input: Context; signal: AbortSignal }) =>
			required(input.capability).asset(required(input.document).assetId, signal)
	}),
	source: createAsyncLogic({
		run: ({ input, signal }: { input: Context; signal: AbortSignal }) =>
			required(input.capability).source(input.id, signal)
	})
}
const model = setup({
	schemas: {
		context: types<Context>(),
		events: { SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>() },
		input: types<ReadInput>(),
		emitted: { record: types<{ result: ReadResult }>() },
		output: types<ReadOutcome>(),
		tags: types<string>(),
		children: {
			document: types<import('xstate').ActorRefFrom<(typeof actors)['document']>>(),
			snapshot: types<import('xstate').ActorRefFrom<(typeof actors)['snapshot']>>(),
			asset: types<import('xstate').ActorRefFrom<(typeof actors)['asset']>>(),
			source: types<import('xstate').ActorRefFrom<(typeof actors)['source']>>()
		}
	},
	actors,
	guards: {
		scopeLost: ({ context }: { context: Context }) => !context.capability?.isCurrent(),
		missingDocument: (
			_args: { context: Context },
			{ document }: { document: DocumentHeader | null }
		) => document === null,
		invalidDocument: (
			{ context }: { context: Context },
			{ document }: { document: DocumentHeader | null }
		) => !isValidDocument(document, context.id),
		missingSnapshot: (
			_args: { context: Context },
			{ snapshot }: { snapshot: TextSnapshot | null }
		) => snapshot === null,
		invalidSnapshot: (
			{ context }: { context: Context },
			{ snapshot }: { snapshot: TextSnapshot | null }
		) => !isValidSnapshot(snapshot, required(context.document))
	},
	actions: {}
})
const input = ({ context }: { context: Context }) => context
/** Own every read, including optional metadata. Only the consumer retains emitted content. */
export const readRecordMachine = model.createMachine({
	id: 'read-record',
	initial: 'document',
	context: ({ input }) => ({
		...clear,
		id: input.id,
		capability: input.capability,
		generation: input.generation ?? 0,
		reportTo: input.reportTo,
		result: { kind: 'unavailable' as const }
	}),
	output: ({ context }) => context.result,
	on: { SHUTDOWN: { target: '.unavailable' } },
	states: {
		document: {
			invoke: {
				id: 'document',
				src: 'document',
				input,
				onDone: (args) => {
					const { event } = args
					if (args.guards.scopeLost(args)) {
						return { target: 'unavailable' }
					}
					if (args.guards.missingDocument(args, { document: event.output })) {
						return { target: 'missing' }
					}
					if (args.guards.invalidDocument(args, { document: event.output })) {
						return { target: 'corrupt' }
					}
					return { target: 'resources', context: { document: event.output ?? undefined } }
				},
				onError: { target: 'unavailable' }
			}
		},
		// Once the header is validated, these independent reads share one owner.
		// Only the required snapshot can fail the read; asset/source remain optional.
		resources: {
			type: 'parallel' as const,
			onDone: { target: 'available' },
			states: {
				snapshot: {
					initial: 'reading',
					states: {
						reading: {
							invoke: {
								id: 'snapshot',
								src: 'snapshot',
								input,
								onDone: (args) => {
									const { event } = args
									if (args.guards.scopeLost(args)) {
										return { target: '#read-record.unavailable' }
									}
									if (args.guards.missingSnapshot(args, { snapshot: event.output })) {
										return { target: '#read-record.unavailable' }
									}
									if (args.guards.invalidSnapshot(args, { snapshot: event.output })) {
										return { target: '#read-record.corrupt' }
									}
									return { target: 'ready', context: { snapshot: event.output ?? undefined } }
								},
								onError: { target: '#read-record.unavailable' }
							}
						},
						ready: { type: 'final' as const }
					}
				},
				asset: {
					initial: 'reading',
					states: {
						reading: {
							invoke: {
								id: 'asset',
								src: 'asset',
								input,
								onDone: (args) => {
									if (args.guards.scopeLost(args)) {
										return { target: '#read-record.unavailable' }
									}
									return { target: 'ready', context: { asset: args.event.output ?? undefined } }
								},
								onError: (args) => {
									if (args.guards.scopeLost(args)) {
										return { target: '#read-record.unavailable' }
									}
									return { target: 'ready' }
								}
							}
						},
						ready: { type: 'final' as const }
					}
				},
				source: {
					initial: 'reading',
					states: {
						reading: {
							invoke: {
								id: 'source',
								src: 'source',
								input,
								onDone: (args) => {
									if (args.guards.scopeLost(args)) {
										return { target: '#read-record.unavailable' }
									}
									return { target: 'ready', context: { source: args.event.output ?? undefined } }
								},
								onError: (args) => {
									if (args.guards.scopeLost(args)) {
										return { target: '#read-record.unavailable' }
									}
									return { target: 'ready' }
								}
							}
						},
						ready: { type: 'final' as const }
					}
				}
			}
		},
		available: {
			type: 'final' as const,
			entry: (args, enq) => {
				let pendingContext = {}

				const { context } = args
				{
					const params = { result: available(context) }
					const { result } = params
					enq.emit({ type: 'record' as const, result })
					if (context.reportTo)
						enq.sendTo(context.reportTo, {
							type: 'READ_RESULT' as const,
							generation: context.generation,
							result
						})
					pendingContext = {
						...pendingContext,
						...clear,
						result: { kind: result.kind }
					}
				}

				return { context: pendingContext }
			}
		},
		missing: {
			type: 'final' as const,
			entry: (args, enq) => {
				let pendingContext = {}

				const { context } = args
				{
					const params = {
						result: {
							kind: context.capability?.isCurrent()
								? ('missing' as const)
								: ('unavailable' as const)
						}
					}
					const { result } = params
					enq.emit({ type: 'record' as const, result })
					if (context.reportTo)
						enq.sendTo(context.reportTo, {
							type: 'READ_RESULT' as const,
							generation: context.generation,
							result
						})
					pendingContext = {
						...pendingContext,
						...clear,
						result: { kind: result.kind }
					}
				}

				return { context: pendingContext }
			}
		},
		corrupt: {
			type: 'final' as const,
			entry: (args, enq) => {
				let pendingContext = {}

				const { context } = args
				{
					const params = {
						result: {
							kind: context.capability?.isCurrent()
								? ('corrupt' as const)
								: ('unavailable' as const)
						}
					}
					const { result } = params
					enq.emit({ type: 'record' as const, result })
					if (context.reportTo)
						enq.sendTo(context.reportTo, {
							type: 'READ_RESULT' as const,
							generation: context.generation,
							result
						})
					pendingContext = {
						...pendingContext,
						...clear,
						result: { kind: result.kind }
					}
				}

				return { context: pendingContext }
			}
		},
		unavailable: {
			type: 'final' as const,
			entry: (args, enq) => {
				let pendingContext = {}

				const { context } = args
				{
					const params = { result: { kind: 'unavailable' as const } }
					const { result } = params
					enq.emit({ type: 'record' as const, result })
					if (context.reportTo)
						enq.sendTo(context.reportTo, {
							type: 'READ_RESULT' as const,
							generation: context.generation,
							result
						})
					pendingContext = {
						...pendingContext,
						...clear,
						result: { kind: result.kind }
					}
				}

				return { context: pendingContext }
			}
		}
	}
})
