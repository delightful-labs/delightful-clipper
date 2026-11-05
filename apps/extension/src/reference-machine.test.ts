import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createReferenceMachine } from './reference-machine.js'
const id = '77777777-7777-4777-8777-777777777777'
const capture = {
	version: 1 as const,
	id,
	tabId: 7,
	documentId: 'document',
	url: 'https://example.com/article',
	phase: 'ready' as const
}
const page = 'chrome-extension://clipper/runtime.html'
async function request(stored: unknown, senderUrl = page, write = vi.fn(async () => {})) {
	const read = vi.fn(async () => stored)
	const actor = createActor(
		createReferenceMachine({ id: 'clipper', page, read, write, remove: async () => {} }),
		{
			input: {
				message: { type: 'ISSUE', id, accountId: id },
				sender: { id: 'clipper', url: senderUrl }
			}
		}
	)
	const result = toPromise(actor)
	actor.start()
	return { result: await result, read, write }
}
it('durably marks only the matching ready reference before allowing dispatch', async () => {
	const f = await request(capture)
	expect(f.result).toEqual({ accepted: true })
	expect(f.write).toHaveBeenCalledWith({ ...capture, phase: 'issued', accountId: id })
})
it('refuses issued, missing and mismatched references without clearing or overwriting them', async () => {
	for (const stored of [
		undefined,
		{ ...capture, phase: 'issued' },
		{ ...capture, id: '88888888-8888-4888-8888-888888888888' }
	]) {
		const f = await request(stored)
		expect(f.result).toEqual({ accepted: false })
		expect(f.write).not.toHaveBeenCalled()
	}
})
it('denies options/source senders before storage access and reports marker-write failure', async () => {
	const denied = await request(capture, 'chrome-extension://clipper/index.html')
	expect(denied.read).not.toHaveBeenCalled()
	const failed = await request(
		capture,
		page,
		vi.fn(async () => {
			throw new Error('storage unavailable')
		})
	)
	expect(failed.result).toEqual({ accepted: false })
})
