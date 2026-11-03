import { assign, fromPromise, setup } from 'xstate'
import type {
	AssetResult,
	DocumentHeader,
	Manifest,
	Part,
	ReadCapabilities,
	ReadResult,
	TextSnapshot
} from '../../contracts/storage.js'

type Context = {
	id: string
	document: DocumentHeader | undefined
	snapshot: TextSnapshot | undefined
	manifest: Manifest | undefined
	parts: Part[]
	asset: AssetResult
	result: ReadResult
}
function requireValue<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Incomplete storage record')
	return value
}
const clearContent = assign<Context, { type: 'SHUTDOWN' }, undefined, { type: 'SHUTDOWN' }, never>({
	document: undefined,
	snapshot: undefined,
	manifest: undefined,
	parts: [],
	asset: { kind: 'unavailable', reason: 'missingParts' }
})
export function createReadRecordMachine(capability: ReadCapabilities) {
	const actors = {
		document: fromPromise(({ input }: { input: string }) => capability.document(input)),
		snapshot: fromPromise(({ input }: { input: string }) => capability.snapshot(input)),
		manifest: fromPromise(({ input }: { input: string }) => capability.manifest(input)),
		parts: fromPromise(({ input }: { input: string }) => capability.parts(input)),
		verifyText: fromPromise(({ input }: { input: TextSnapshot }) => capability.verifyText(input)),
		decode: fromPromise(({ input }: { input: { manifest: Manifest; parts: Part[] } }) =>
			capability.decode(input)
		)
	}
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
		context: ({ input }) => ({
			id: input.id,
			document: undefined,
			snapshot: undefined,
			manifest: undefined,
			parts: [],
			asset: { kind: 'unavailable', reason: 'missingParts' },
			result: { kind: 'unavailable' }
		}),
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
					input: ({ context }) => requireValue(context.document).snapshotId,
					onDone: [
						{ guard: ({ event }) => event.output === null, target: 'unavailable' },
						{
							target: 'verifyText',
							actions: assign({ snapshot: ({ event }) => event.output ?? undefined })
						}
					],
					onError: 'unavailable'
				}
			},
			verifyText: {
				invoke: {
					src: 'verifyText',
					input: ({ context }) => requireValue(context.snapshot),
					onDone: [
						{ guard: ({ event }) => event.output, target: 'manifest' },
						{ target: 'corrupt' }
					],
					onError: 'corrupt'
				}
			},
			manifest: {
				invoke: {
					src: 'manifest',
					input: ({ context }) => requireValue(context.document).manifestId,
					onDone: [
						{ guard: ({ event }) => event.output === null, target: 'available' },
						{
							target: 'parts',
							actions: assign({ manifest: ({ event }) => event.output ?? undefined })
						}
					],
					onError: 'available'
				}
			},
			parts: {
				invoke: {
					src: 'parts',
					input: ({ context }) => requireValue(context.manifest).id,
					onDone: { target: 'checkParts', actions: assign({ parts: ({ event }) => event.output }) },
					onError: 'available'
				}
			},
			checkParts: {
				always: [
					{
						guard: ({ context }) =>
							context.parts.length !== requireValue(context.manifest).partCount,
						target: 'available'
					},
					{ target: 'decode' }
				]
			},
			decode: {
				invoke: {
					src: 'decode',
					input: ({ context }) => ({
						manifest: requireValue(context.manifest),
						parts: context.parts
					}),
					onDone: {
						target: 'available',
						actions: assign({
							asset: ({ context, event }) => ({
								kind: 'available',
								bytes: event.output,
								mediaType: requireValue(context.manifest).mediaType
							})
						})
					},
					onError: {
						target: 'available',
						actions: assign({ asset: { kind: 'unavailable', reason: 'integrityMismatch' } })
					}
				}
			},
			available: {
				type: 'final',
				entry: assign(({ context }) => ({
					result: capability.isCurrent()
						? {
								kind: 'available',
								document: requireValue(context.document),
								text: requireValue(context.snapshot).text,
								asset: context.asset
							}
						: { kind: 'unavailable' },
					document: undefined,
					snapshot: undefined,
					manifest: undefined,
					parts: [],
					asset: { kind: 'unavailable', reason: 'missingParts' }
				}))
			},
			missing: { type: 'final', entry: [assign({ result: { kind: 'missing' } }), clearContent] },
			corrupt: {
				type: 'final',
				entry: [
					assign(() => ({
						result: { kind: capability.isCurrent() ? 'corrupt' : 'unavailable' }
					})),
					clearContent
				]
			},
			unavailable: { type: 'final', entry: clearContent }
		}
	})
}
