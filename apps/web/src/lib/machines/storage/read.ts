import { assign, fromPromise, setup } from 'xstate'
import type {
	DocumentHeader,
	ReadCapabilities,
	ReadResult,
	StoredAsset,
	TextSnapshot
} from '../../contracts/storage.js'
import { BYTE_LIMIT, TEXT_LIMIT } from '../../storage/prepare.js'
type Context = {
	id: string
	document: DocumentHeader | undefined
	snapshot: TextSnapshot | undefined
	asset: StoredAsset | undefined
	result: ReadResult
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Incomplete record')
	return value
}
export function createReadRecordMachine(capability: ReadCapabilities) {
	const actors = {
		document: fromPromise(({ input }: { input: string }) => capability.document(input)),
		snapshot: fromPromise(({ input }: { input: string }) => capability.snapshot(input)),
		asset: fromPromise(({ input }: { input: string }) => capability.asset(input))
	}
	const clear = { document: undefined, snapshot: undefined, asset: undefined }
	return setup<
		Context,
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		{ id: string },
		ReadResult
	>({ actors }).createMachine({
		id: 'read-record',
		initial: 'document',
		context: ({ input }) => ({ id: input.id, ...clear, result: { kind: 'unavailable' } }),
		output: ({ context }) => context.result,
		on: { SHUTDOWN: '.unavailable' },
		states: {
			document: {
				invoke: {
					src: 'document',
					input: ({ context }) => context.id,
					onDone: [
						{ guard: ({ event }) => event.output === null, target: 'missing' },
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
					input: ({ context }) => required(context.document).snapshotId,
					onDone: [
						{ guard: ({ event }) => event.output === null, target: 'unavailable' },
						{
							guard: ({ context, event }) =>
								event.output?.formatVersion !== '1' ||
								event.output.id !== required(context.document).snapshotId ||
								event.output.libraryId !== required(context.document).libraryId ||
								event.output.documentId !== required(context.document).operationId ||
								new TextEncoder().encode(event.output.text).byteLength > TEXT_LIMIT,
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
					input: ({ context }) => required(context.document).assetId,
					onDone: {
						target: 'available',
						actions: assign({ asset: ({ event }) => event.output ?? undefined })
					},
					onError: 'available'
				}
			},
			available: {
				type: 'final',
				entry: assign(({ context }) => {
					const document = required(context.document),
						snapshot = required(context.snapshot),
						asset = context.asset
					const valid =
						asset &&
						asset.id === document.assetId &&
						asset.libraryId === document.libraryId &&
						asset.operationId === document.operationId &&
						asset.payload.byteLength <= BYTE_LIMIT &&
						asset.mediaType.trim().length > 0 &&
						asset.mediaType.length <= 150
					return {
						...clear,
						result: capability.isCurrent()
							? {
									kind: 'available',
									document,
									text: snapshot.text,
									asset: valid
										? { kind: 'available', bytes: asset.payload, mediaType: asset.mediaType }
										: { kind: 'unavailable', reason: asset ? 'invalid' : 'missing' }
								}
							: { kind: 'unavailable' }
					}
				})
			},
			missing: {
				type: 'final',
				entry: assign(() => ({
					...clear,
					result: { kind: capability.isCurrent() ? 'missing' : 'unavailable' }
				}))
			},
			corrupt: {
				type: 'final',
				entry: assign(() => ({
					...clear,
					result: { kind: capability.isCurrent() ? 'corrupt' : 'unavailable' }
				}))
			},
			unavailable: { type: 'final', entry: assign({ ...clear, result: { kind: 'unavailable' } }) }
		}
	})
}
