import { assign, enqueueActions, fromPromise, setup } from 'xstate'
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
	document: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
		required(input.capability).document(input.id, signal)
	),
	snapshot: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
		required(input.capability).snapshot(required(input.document).snapshotId, signal)
	),
	asset: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
		required(input.capability).asset(required(input.document).assetId, signal)
	),
	source: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
		required(input.capability).source(input.id, signal)
	)
}
const model = setup<
	Context,
	{ type: 'SHUTDOWN' },
	typeof actors,
	{},
	{ report: { result: ReadResult } },
	{ scopeLost: undefined },
	never,
	string,
	ReadInput,
	ReadOutcome,
	{ type: 'record'; result: ReadResult }
>({
	actors,
	guards: { scopeLost: ({ context }) => !context.capability?.isCurrent() },
	actions: {
		report: enqueueActions(({ context, enqueue }, { result }) => {
			enqueue.emit({ type: 'record', result })
			if (context.reportTo)
				enqueue.sendTo(context.reportTo, {
					type: 'READ_RESULT',
					generation: context.generation,
					result
				})
			enqueue.assign({ ...clear, result: { kind: result.kind } })
		})
	}
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
		result: { kind: 'unavailable' }
	}),
	output: ({ context }) => context.result,
	on: { SHUTDOWN: '.unavailable' },
	states: {
		document: {
			invoke: {
				src: 'document',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'unavailable' },
					{ guard: ({ event }) => event.output === null, target: 'missing' },
					{
						guard: ({ context, event }) => !isValidDocument(event.output, context.id),
						target: 'corrupt'
					},
					{
						target: 'snapshot',
						actions: assign({ document: ({ event }) => event.output ?? undefined })
					}
				],
				onError: 'unavailable'
			}
		},
		snapshot: {
			invoke: {
				src: 'snapshot',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'unavailable' },
					{ guard: ({ event }) => event.output === null, target: 'unavailable' },
					{
						guard: ({ context, event }) =>
							!isValidSnapshot(event.output, required(context.document)),
						target: 'corrupt'
					},
					{
						target: 'asset',
						actions: assign({ snapshot: ({ event }) => event.output ?? undefined })
					}
				],
				onError: 'unavailable'
			}
		},
		asset: {
			invoke: {
				src: 'asset',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'unavailable' },
					{ target: 'source', actions: assign({ asset: ({ event }) => event.output ?? undefined }) }
				],
				onError: [{ guard: 'scopeLost', target: 'unavailable' }, { target: 'source' }]
			}
		},
		source: {
			invoke: {
				src: 'source',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'unavailable' },
					{
						target: 'available',
						actions: assign({ source: ({ event }) => event.output ?? undefined })
					}
				],
				onError: [{ guard: 'scopeLost', target: 'unavailable' }, { target: 'available' }]
			}
		},
		available: {
			type: 'final',
			entry: { type: 'report', params: ({ context }) => ({ result: available(context) }) }
		},
		missing: {
			type: 'final',
			entry: {
				type: 'report',
				params: ({ context }) => ({
					result: { kind: context.capability?.isCurrent() ? 'missing' : 'unavailable' }
				})
			}
		},
		corrupt: {
			type: 'final',
			entry: {
				type: 'report',
				params: ({ context }) => ({
					result: { kind: context.capability?.isCurrent() ? 'corrupt' : 'unavailable' }
				})
			}
		},
		unavailable: {
			type: 'final',
			entry: { type: 'report', params: { result: { kind: 'unavailable' } } }
		}
	}
})
