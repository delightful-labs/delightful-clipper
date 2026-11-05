import { expect, it } from 'vitest'
import { stateFeedback } from './feedback.js'
it('projects independent names from parallel state channels', () => {
	const states = [
		undefined,
		{ channel: 'reader', name: 'Readable', variant: 'info' as const },
		{ channel: 'organization', name: 'Sync rejected', variant: 'error' as const }
	]
	expect(stateFeedback(states, 'reader')).toEqual({ text: 'Readable', variant: 'info' })
	expect(stateFeedback(states, 'organization')).toEqual({ text: 'Sync rejected', variant: 'error' })
	expect(stateFeedback(states)).toBeUndefined()
})
it('uses explicit priority for concurrent state names and returns no message after exit', () => {
	expect(
		stateFeedback([
			{ name: 'Saving', variant: 'info' },
			{ name: 'Worker failed', variant: 'error', priority: 1 }
		])
	).toEqual({ text: 'Worker failed', variant: 'error' })
	expect(stateFeedback([])).toBeUndefined()
})
