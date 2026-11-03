import { expect, it } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { createReadRecordMachine } from './read.js'
import { prepareSave, decodeAsset, verifyText } from '../../storage/codec.js'

it.each(['success', 'corrupt', 'shutdown', 'account'] as const)(
	'clears intermediate content after %s',
	async (mode) => {
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
				document: async () => draft.document,
				snapshot: async () => draft.snapshot,
				manifest: async () => {
					if (mode === 'shutdown') return new Promise(() => {})
					if (mode === 'account') current = false
					return draft.manifest
				},
				parts: async () => draft.parts,
				verifyText: mode === 'corrupt' ? async () => false : verifyText,
				decode: decodeAsset
			}),
			{ input: { id: draft.document.id } }
		).start()
		if (mode === 'shutdown') {
			await waitFor(actor, (s) => s.matches('manifest'))
			actor.send({ type: 'SHUTDOWN' })
		}
		const result = await toPromise(actor)
		expect(result.kind).toBe(
			mode === 'success' ? 'available' : mode === 'corrupt' ? 'corrupt' : 'unavailable'
		)
		const context = actor.getSnapshot().context
		expect(context.document).toBeUndefined()
		expect(context.snapshot).toBeUndefined()
		expect(context.manifest).toBeUndefined()
		expect(context.parts).toEqual([])
		expect(context.asset.kind).toBe('unavailable')
	}
)
