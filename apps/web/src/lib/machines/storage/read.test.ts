import type { ReadResult } from '../../contracts/storage.js'
import { expect, it } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { readRecordMachine } from './read.js'
import { prepareSave } from '../../storage/prepare.js'

it.each([
	'success',
	'corrupt',
	'shutdown',
	'account',
	'missingAsset',
	'invalidAsset',
	'missingSnapshot',
	'missingDocument'
] as const)('clears intermediate content after %s', async (mode) => {
	const draft = await prepareSave(crypto.randomUUID(), {
		operationId: crypto.randomUUID(),
		title: 'Title',
		text: 'private text',
		bytes: new Uint8Array([1, 2, 3]),
		mediaType: 'application/octet-stream'
	})
	let current = true
	const delivered: { value: ReadResult } = { value: { kind: 'unavailable' } }
	const actor = createActor(readRecordMachine, {
		input: {
			capability: {
				isCurrent: () => current,
				source: async () => null,
				document: async () => (mode === 'missingDocument' ? null : draft.document),
				snapshot: async () =>
					mode === 'missingSnapshot'
						? null
						: mode === 'corrupt'
							? { ...draft.snapshot, formatVersion: 'unsupported' }
							: draft.snapshot,
				asset: async () => {
					if (mode === 'shutdown') return new Promise(() => {})
					if (mode === 'account') current = false
					if (mode === 'missingAsset') return null
					if (mode === 'invalidAsset') return { ...draft.asset, libraryId: crypto.randomUUID() }
					return draft.asset
				}
			},
			id: draft.document.id
		}
	})
	actor.on('record', ({ result }) => {
		delivered.value = result
	})
	actor.start()
	if (mode === 'shutdown') {
		await waitFor(actor, (s) => s.matches('asset'))
		actor.send({ type: 'SHUTDOWN' })
	}
	await toPromise(actor)
	const result = delivered.value
	expect(result.kind).toBe(
		['success', 'missingAsset', 'invalidAsset'].includes(mode)
			? 'available'
			: mode === 'corrupt'
				? 'corrupt'
				: mode === 'missingDocument'
					? 'missing'
					: 'unavailable'
	)
	if (result.kind === 'available') {
		expect(result.text).toBe(draft.snapshot.text)
		expect(result.asset.kind).toBe(mode === 'success' ? 'available' : 'unavailable')
	}
	const context = actor.getSnapshot().context
	expect(context.document).toBeUndefined()
	expect(context.snapshot).toBeUndefined()
	expect(context.asset).toBeUndefined()
	expect(context.source).toBeUndefined()
	expect(context.capability).toBeUndefined()
	expect(context.result).toEqual({ kind: result.kind })
	expect(actor.getSnapshot().output).toEqual({ kind: result.kind })
})

it.each(['document', 'snapshot', 'asset', 'source'] as const)(
	'discards late content on scope loss during %s',
	async (boundary) => {
		const draft = await prepareSave(crypto.randomUUID(), {
			operationId: crypto.randomUUID(),
			title: 'Private',
			text: 'private',
			bytes: new Uint8Array([1]),
			mediaType: 'text/plain'
		})
		let current = true
		const pending = Promise.withResolvers<void>()
		const called: string[] = []
		let result: ReadResult | undefined
		const block = async (name: string) => {
			called.push(name)
			if (name === boundary) await pending.promise
		}
		const actor = createActor(readRecordMachine, {
			input: {
				capability: {
					isCurrent: () => current,
					source: async () => {
						await block('source')
						return null
					},
					document: async () => {
						await block('document')
						return draft.document
					},
					snapshot: async () => {
						await block('snapshot')
						return draft.snapshot
					},
					asset: async () => {
						await block('asset')
						return draft.asset
					}
				},
				id: draft.document.id
			}
		})
		actor.on('record', (event) => {
			result = event.result
		})
		actor.start()
		await waitFor(actor, (s) => s.matches(boundary))
		current = false
		pending.resolve()
		await toPromise(actor)
		expect(result).toEqual({ kind: 'unavailable' })
		expect(called).toEqual(
			['document', 'snapshot', 'asset', 'source'].slice(
				0,
				['document', 'snapshot', 'asset', 'source'].indexOf(boundary) + 1
			)
		)
		expect(actor.getSnapshot().context).toMatchObject({
			document: undefined,
			snapshot: undefined,
			asset: undefined,
			result: { kind: 'unavailable' }
		})
	}
)

it.each(['valid', 'missing', 'invalid', 'failure'] as const)(
	'preserves readable text when source metadata is %s',
	async (mode) => {
		const draft = await prepareSave(crypto.randomUUID(), {
			operationId: crypto.randomUUID(),
			title: 'Saved',
			text: 'Readable text',
			bytes: new Uint8Array([1]),
			mediaType: 'text/html'
		})
		const source = {
			id: draft.document.id,
			documentId: draft.document.id,
			libraryId: draft.document.libraryId,
			finalUrl: 'https://example.com/',
			submittedUrl: 'https://short.example/',
			provenance: '{}'
		}
		const actor = createActor(readRecordMachine, {
			input: {
				id: draft.document.id,
				capability: {
					isCurrent: () => true,
					document: async () => draft.document,
					snapshot: async () => draft.snapshot,
					asset: async () => draft.asset,
					source: async () => {
						if (mode === 'failure') throw new Error('Metadata unavailable')
						return mode === 'missing'
							? null
							: mode === 'invalid'
								? { ...source, libraryId: crypto.randomUUID() }
								: source
					}
				}
			}
		})
		const results: ReadResult[] = []
		actor.on('record', (event) => results.push(event.result))
		actor.start()
		await toPromise(actor)
		expect(results).toHaveLength(1)
		expect(results[0]).toMatchObject({ kind: 'available', text: 'Readable text' })
		if (mode === 'valid') expect(results[0]).toHaveProperty('source', source)
		else expect(results[0]).not.toHaveProperty('source')
		expect(actor.getSnapshot().context).toMatchObject({
			document: undefined,
			snapshot: undefined,
			asset: undefined,
			source: undefined,
			capability: undefined,
			reportTo: undefined
		})
		expect(actor.getSnapshot().output).toEqual({ kind: 'available' })
	}
)
it('aborts optional metadata on shutdown and ignores its late content', async () => {
	const draft = await prepareSave(crypto.randomUUID(), {
		operationId: crypto.randomUUID(),
		title: 'Saved',
		text: 'Readable text',
		bytes: new Uint8Array([1]),
		mediaType: 'text/plain'
	})
	const pending = Promise.withResolvers<null>()
	let signal: AbortSignal | undefined
	const actor = createActor(readRecordMachine, {
		input: {
			id: draft.document.id,
			capability: {
				isCurrent: () => true,
				document: async () => draft.document,
				snapshot: async () => draft.snapshot,
				asset: async () => draft.asset,
				source: (_id, abort) => {
					signal = abort
					return pending.promise
				}
			}
		}
	})
	const results: ReadResult[] = []
	actor.on('record', (event) => results.push(event.result))
	actor.start()
	await waitFor(actor, (s) => s.matches('source'))
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect(signal?.aborted).toBe(true)
	pending.resolve(null)
	await Promise.resolve()
	expect(results).toEqual([{ kind: 'unavailable' }])
	expect(actor.getSnapshot().context).toMatchObject({
		snapshot: undefined,
		source: undefined,
		capability: undefined
	})
})
