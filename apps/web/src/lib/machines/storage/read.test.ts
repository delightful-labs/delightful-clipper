import { expect, it } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { createReadRecordMachine } from './read.js'
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
	const actor = createActor(
		createReadRecordMachine({
			isCurrent: () => current,
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
		}),
		{ input: { id: draft.document.id } }
	).start()
	if (mode === 'shutdown') {
		await waitFor(actor, (s) => s.matches('asset'))
		actor.send({ type: 'SHUTDOWN' })
	}
	const result = await toPromise(actor)
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
})
