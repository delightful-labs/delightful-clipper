import { createActor, createCallbackLogic } from 'xstate'
import { expect, it, vi } from 'vitest'
import type { LibraryEvent } from '../../contracts/library.js'
import { tagKey, tagSelectionChange } from '../../capture/tags.js'
import { tagFormMachine, selectTagFormView } from './tag-form.js'
it('validates DUI selections and delegates only one canonical membership edit', () => {
	const submit = vi.fn()
	const library = createActor(
		createCallbackLogic<LibraryEvent>(({ receive }) => receive(submit))
	).start()
	const actor = createActor(tagFormMachine, { input: { library } }).start()
	const choose = (
		names: string[],
		previous: { key: string; name: string }[] = [],
		enabled = true
	) => actor.send({ type: 'SELECT', id: 'article', names, previous, enabled })
	choose(['a'.repeat(65)])
	expect(selectTagFormView(actor.getSnapshot()).message?.text).toBe('Enter tag')
	expect(submit).not.toHaveBeenCalled()
	actor.send({ type: 'RESET' })
	expect(selectTagFormView(actor.getSnapshot()).message).toBeUndefined()
	choose(['Straße'], [], false)
	expect(submit).not.toHaveBeenCalled()
	choose(['Straße'])
	expect(submit).toHaveBeenCalledExactlyOnceWith({
		type: 'ORGANIZE',
		request: { id: 'article', field: 'tag', value: 'Straße', assigned: true }
	})
	const previous = [{ key: tagKey('Straße'), name: 'Straße' }]
	choose(['Straße', 'STRASSE'], previous)
	expect(submit).toHaveBeenCalledOnce()
	choose([], previous)
	expect(submit).toHaveBeenLastCalledWith({
		type: 'ORGANIZE',
		request: { id: 'article', field: 'tag', value: 'Straße', assigned: false }
	})
	actor.stop()
	library.stop()
})
it('rejects multi-change replacement while preserving normalized equivalence', () => {
	expect(tagSelectionChange([], ['One', 'Two'])).toEqual({ kind: 'invalid' })
	expect(tagSelectionChange([{ key: tagKey('Café'), name: 'Café' }], ['Cafe\u0301'])).toEqual({
		kind: 'unchanged'
	})
})
