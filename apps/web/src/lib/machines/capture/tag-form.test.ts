import { createActor, fromCallback } from 'xstate'
import { expect, it, vi } from 'vitest'
import { tagFormMachine, selectTagFormView } from './tag-form.js'
it('keeps invalid names out of native writes, clears feedback on edit/reset, and respects disabled submission', () => {
	const submit = vi.fn()
	const library = createActor(
		fromCallback<import('../../contracts/library.js').LibraryEvent>(({ receive }) =>
			receive(submit)
		)
	).start()
	const actor = createActor(tagFormMachine, { input: { library } }).start()
	actor.send({ type: 'SUBMIT', id: 'article', enabled: true })
	expect(selectTagFormView(actor.getSnapshot()).message?.text).toBe('Enter tag')
	actor.send({ type: 'CHANGE', name: 'a'.repeat(65) })
	actor.send({ type: 'SUBMIT', id: 'article', enabled: true })
	expect(submit).not.toHaveBeenCalled()
	actor.send({ type: 'CHANGE', name: 'Straße' })
	expect(selectTagFormView(actor.getSnapshot()).message).toBeUndefined()
	actor.send({ type: 'SUBMIT', id: 'article', enabled: false })
	expect(submit).not.toHaveBeenCalled()
	actor.send({ type: 'SUBMIT', id: 'article', enabled: true })
	expect(submit).toHaveBeenCalledExactlyOnceWith({
		type: 'ORGANIZE',
		request: { id: 'article', field: 'tag', value: 'Straße', assigned: true }
	})
	expect(selectTagFormView(actor.getSnapshot()).name).toBe('')
	actor.send({ type: 'SUBMIT', id: 'article', enabled: true })
	actor.send({ type: 'RESET' })
	expect(selectTagFormView(actor.getSnapshot()).invalid).toBe(false)
	actor.stop()
	library.stop()
})
