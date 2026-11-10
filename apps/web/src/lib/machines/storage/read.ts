import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic } from 'xstate'
import { createLocalReadMachine } from './local-read.js'

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
	if (!context.capability?.isCurrent()) return { kind: 'unavailable' }
	const document = required(context.document),
		snapshot = required(context.snapshot),
		asset = context.asset,
		source = context.source

	return {
		kind: 'available',
		document,
		text: snapshot.text,
		asset: isValidAsset(asset, document)
			? { kind: 'available', bytes: asset.payload, mediaType: asset.mediaType }
			: { kind: 'unavailable', reason: asset ? 'invalid' : 'missing' },
		...(isValidSource(source, document) ? { source } : {})
	}
}
const actors = {
	document: createLocalReadMachine<DocumentHeader>(),
	snapshot: createLocalReadMachine<TextSnapshot>(),
	asset: createLocalReadMachine<StoredAsset>(),
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
function documentInput({ context }: { context: Context }) {
	const capability = required(context.capability)
	return {
		isCurrent: capability.isCurrent,
		observeConnection: capability.observeConnection,
		read: (signal: AbortSignal) => capability.document(context.id, signal)
	}
}
function snapshotInput({ context }: { context: Context }) {
	const capability = required(context.capability)
	return {
		isCurrent: capability.isCurrent,
		observeConnection: capability.observeConnection,
		read: (signal: AbortSignal) =>
			capability.snapshot(required(context.document).snapshotId, signal)
	}
}
function assetInput({ context }: { context: Context }) {
	const capability = required(context.capability)
	return {
		isCurrent: capability.isCurrent,
		observeConnection: capability.observeConnection,
		read: (signal: AbortSignal) => capability.asset(required(context.document).assetId, signal)
	}
}
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
		result: { kind: 'unavailable' }
	}),
	output: ({ context }) => context.result,
	on: { SHUTDOWN: { target: '.unavailable' } },
	states: {
		document: {
			invoke: {
				id: 'document',
				src: 'document',
				input: documentInput,
				onDone: (args) => {
					const { event } = args
					const row = event.output.row
					if (args.guards.scopeLost(args)) {
						return { target: 'unavailable' }
					}
					if (args.guards.missingDocument(args, { document: row })) {
						return { target: 'missing' }
					}
					if (args.guards.invalidDocument(args, { document: row })) {
						return { target: 'corrupt' }
					}
					return { target: 'resources', context: { document: row ?? undefined } }
				},
				onError: { target: 'unavailable' }
			}
		},
		// Once the header is validated, these independent reads share one owner.
		// Only the required snapshot can fail the read; asset/source remain optional.
		resources: {
			type: 'parallel',
			onDone: { target: 'available' },
			states: {
				snapshot: {
					initial: 'reading',
					states: {
						reading: {
							invoke: {
								id: 'snapshot',
								src: 'snapshot',
								input: snapshotInput,
								onDone: (args) => {
									const { event } = args
									const row = event.output.row
									if (args.guards.scopeLost(args)) {
										return { target: '#read-record.unavailable' }
									}
									if (args.guards.missingSnapshot(args, { snapshot: row })) {
										return { target: '#read-record.unavailable' }
									}
									if (args.guards.invalidSnapshot(args, { snapshot: row })) {
										return { target: '#read-record.corrupt' }
									}
									return { target: 'ready', context: { snapshot: row ?? undefined } }
								},
								onError: { target: '#read-record.unavailable' }
							}
						},
						ready: { type: 'final' }
					}
				},
				asset: {
					initial: 'reading',
					states: {
						reading: {
							invoke: {
								id: 'asset',
								src: 'asset',
								input: assetInput,
								onDone: (args) => {
									if (args.guards.scopeLost(args)) {
										return { target: '#read-record.unavailable' }
									}
									return { target: 'ready', context: { asset: args.event.output.row ?? undefined } }
								},
								onError: (args) => {
									if (args.guards.scopeLost(args)) {
										return { target: '#read-record.unavailable' }
									}
									return { target: 'ready' }
								}
							}
						},
						ready: { type: 'final' }
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
						ready: { type: 'final' }
					}
				}
			}
		},
		available: {
			type: 'final',
			entry: (args, enq) => {
				let pendingContext = {}

				const { context } = args
				{
					const params = { result: available(context) }
					const { result } = params
					enq.emit({ type: 'record', result })
					if (context.reportTo)
						enq.sendTo(context.reportTo, {
							type: 'READ_RESULT',
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
			type: 'final',
			entry: (args, enq) => {
				let pendingContext = {}

				const { context } = args
				{
					const params: { result: ReadResult } = {
						result: {
							kind: context.capability?.isCurrent() ? 'missing' : 'unavailable'
						}
					}
					const { result } = params
					enq.emit({ type: 'record', result })
					if (context.reportTo)
						enq.sendTo(context.reportTo, {
							type: 'READ_RESULT',
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
			type: 'final',
			entry: (args, enq) => {
				let pendingContext = {}

				const { context } = args
				{
					const params: { result: ReadResult } = {
						result: {
							kind: context.capability?.isCurrent() ? 'corrupt' : 'unavailable'
						}
					}
					const { result } = params
					enq.emit({ type: 'record', result })
					if (context.reportTo)
						enq.sendTo(context.reportTo, {
							type: 'READ_RESULT',
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
			type: 'final',
			entry: (args, enq) => {
				let pendingContext = {}

				const { context } = args
				{
					const params: { result: ReadResult } = { result: { kind: 'unavailable' } }
					const { result } = params
					enq.emit({ type: 'record', result })
					if (context.reportTo)
						enq.sendTo(context.reportTo, {
							type: 'READ_RESULT',
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
