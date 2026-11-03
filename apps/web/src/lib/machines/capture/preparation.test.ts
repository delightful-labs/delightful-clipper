import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { preparationMachine } from './preparation.js'
import { libraryMachine } from './library.js'
import { testLibraryCapability } from './library.test-support.js'
import type { Candidate } from '../../capture/source.js'
const candidate: Candidate = {
	id: crypto.randomUUID(),
	title: 'Private',
	text: 'private text',
	html: '<p>private text</p>',
	finalUrl: 'https://example.com/final',
	submittedUrl: 'https://short.example/',
	provenance: '{}',
	imagesMissing: false
}
const boundaries = [
	'resolving',
	'identifyingResolved',
	'checkingResolvedDocument',
	'checkingResolvedIntent',
	'extracting',
	'identifyingExtracted',
	'checkingExtractedDocument',
	'checkingExtractedIntent'
] as const
function gated(boundary: (typeof boundaries)[number]) {
	const gate = Promise.withResolvers<void>(),
		entered = Promise.withResolvers<void>()
	let signal: AbortSignal | undefined,
		current = true,
		identifyCount = 0,
		documentCount = 0,
		intentCount = 0
	const calls: string[] = []
	const step = async (name: (typeof boundaries)[number], abort: AbortSignal) => {
		calls.push(name)
		if (name === boundary) {
			signal = abort
			entered.resolve()
			await gate.promise
		}
	}
	const capability = testLibraryCapability(candidate, {
		isCurrent: () => current,
		resolve: async (_url, _id, abort) => {
			await step('resolving', abort)
			return 'https://example.com/resolved'
		},
		identify: async (_url, abort) => {
			await step(++identifyCount === 1 ? 'identifyingResolved' : 'identifyingExtracted', abort)
			return candidate.id
		},
		hasDocument: async (_id, abort) => {
			await step(
				++documentCount === 1 ? 'checkingResolvedDocument' : 'checkingExtractedDocument',
				abort
			)
			return false
		},
		hasIntent: async (_id, abort) => {
			await step(++intentCount === 1 ? 'checkingResolvedIntent' : 'checkingExtractedIntent', abort)
			return false
		},
		extract: async (_url, _id, abort) => {
			await step('extracting', abort)
			return candidate
		}
	})
	return {
		gate,
		entered,
		capability,
		calls,
		get signal() {
			return signal
		},
		expire: () => {
			current = false
		}
	}
}
it.each(boundaries)(
	'stops at %s on account scope loss before invoking another leaf',
	async (boundary) => {
		const fixture = gated(boundary)
		const actor = createActor(preparationMachine, {
			input: { capability: fixture.capability, url: candidate.submittedUrl }
		}).start()
		await fixture.entered.promise
		fixture.expire()
		fixture.gate.resolve()
		expect(await toPromise(actor)).toEqual({ kind: 'scopeChanged' })
		expect(fixture.calls).toEqual(boundaries.slice(0, boundaries.indexOf(boundary) + 1))
		expect(actor.getSnapshot().context.candidate).toBeUndefined()
	}
)
it.each(boundaries)(
	'cancels the invoked leaf at %s and ignores its late result',
	async (boundary) => {
		const fixture = gated(boundary)
		const actor = createActor(libraryMachine, { input: fixture.capability }).start()
		actor.send({ type: 'ADD', url: candidate.submittedUrl })
		await fixture.entered.promise
		actor.send({ type: 'CANCEL' })
		expect(fixture.signal?.aborted).toBe(true)
		fixture.gate.resolve()
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(fixture.calls).toEqual(boundaries.slice(0, boundaries.indexOf(boundary) + 1))
		expect(actor.getSnapshot().can({ type: 'SAVE' })).toBe(false)
		expect(actor.getSnapshot().context.preview).toBeUndefined()
		actor.send({ type: 'SHUTDOWN' })
		await toPromise(actor)
	}
)
it('checks the destination again when extraction observes a changed redirect target', async () => {
	const extract = vi.fn(async () => candidate),
		documents: string[] = []
	const capability = testLibraryCapability(candidate, {
		resolve: async () => 'https://example.com/before',
		identify: async (url) => url,
		hasDocument: async (id) => {
			documents.push(id)
			return id === candidate.finalUrl
		},
		extract
	})
	const result = await toPromise(
		createActor(preparationMachine, { input: { capability, url: candidate.submittedUrl } }).start()
	)
	expect(result).toEqual({ kind: 'duplicate', id: candidate.finalUrl })
	expect(documents).toEqual(['https://example.com/before', candidate.finalUrl])
	expect(extract).toHaveBeenCalledOnce()
})
it('does not extract or write after an existing unresolved operation', async () => {
	const extract = vi.fn(async () => candidate),
		spawnSave = vi.fn()
	const capability = testLibraryCapability(candidate, {
		hasIntent: async () => true,
		extract,
		spawnSave
	})
	const result = await toPromise(
		createActor(preparationMachine, { input: { capability, url: candidate.submittedUrl } }).start()
	)
	expect(result).toEqual({ kind: 'uncertain', id: candidate.id })
	expect(extract).not.toHaveBeenCalled()
	expect(spawnSave).not.toHaveBeenCalled()
})
it('routes extraction failure to the owning workflow without exposing a preview', async () => {
	const actor = createActor(libraryMachine, {
		input: testLibraryCapability(candidate, {
			extract: async () => {
				throw new Error('sourceTooLarge')
			}
		})
	}).start()
	actor.send({ type: 'ADD', url: candidate.submittedUrl })
	await waitFor(actor, (s) => s.matches({ running: { capture: 'failed' } }))
	expect(actor.getSnapshot().context.failure).toBe('sourceTooLarge')
	expect(actor.getSnapshot().context.preview).toBeUndefined()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
