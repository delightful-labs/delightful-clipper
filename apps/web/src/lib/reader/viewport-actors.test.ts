import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor, setup } from 'xstate'
import type { ReadingViewport, ViewportObservationEvent } from '../contracts/reader.js'
import type { ReaderExperienceEvent } from '../machines/reader/experience.js'
import type { ReadingPosition } from './schema.js'
import {
	finalReadingPosition,
	viewportObservation,
	viewportRestoration
} from './viewport-actors.js'

const position: ReadingPosition = {
	version: 1,
	offset: 10,
	quote: 'Reading',
	prefix: '',
	suffix: '',
	progress: 0.3,
	interactedAt: '2026-11-05T12:00:00.000Z'
}
beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal(
		'requestAnimationFrame',
		vi.fn((callback: FrameRequestCallback) => setTimeout(() => callback(0), 1))
	)
	vi.stubGlobal(
		'cancelAnimationFrame',
		vi.fn((id: number) => clearTimeout(id))
	)
})
afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

function fixture() {
	let report!: (event: ViewportObservationEvent) => void
	const dispose = vi.fn(),
		measure = vi.fn<ReadingViewport['measure']>(() => position),
		restore = vi.fn<ReadingViewport['restore']>()
	const viewport: ReadingViewport = {
		measure,
		restore,
		observe: (next) => {
			report = next
			next({ type: 'BASELINE', sizes: [{ width: 800, height: 600 }] })
			return dispose
		}
	}
	return {
		viewport,
		measure,
		restore,
		dispose,
		report: (event: ViewportObservationEvent) => report(event)
	}
}
function owner(viewport: ReadingViewport, mode: 'observing' | 'restoring' = 'observing') {
	const reports: (ReaderExperienceEvent | { type: 'RESTORE' })[] = []
	const actor = createActor(
		setup<
			{},
			ReaderExperienceEvent | { type: 'RESTORE' },
			{
				viewportObservation: typeof viewportObservation
				viewportRestoration: typeof viewportRestoration
			}
		>({
			actors: { viewportObservation, viewportRestoration }
		}).createMachine({
			initial: mode,
			states: {
				observing: {
					invoke: { src: 'viewportObservation', input: { id: 'current', viewport }, onDone: {} }
				},
				restoring: {
					invoke: {
						src: 'viewportRestoration',
						input: { id: 'current', viewport, position },
						onDone: {}
					}
				}
			},
			on: {
				RESTORE: '.restoring',
				'*': {
					actions: ({ event }) => {
						reports.push(event)
					}
				}
			}
		})
	).start()
	return { actor, reports }
}
it('coalesces scroll and eligible input into one frame and excludes controls', async () => {
	const port = fixture(),
		{ actor, reports } = owner(port.viewport)
	port.report({ type: 'INTERACT', eligible: false })
	expect(reports).toEqual([])
	expect(requestAnimationFrame).not.toHaveBeenCalled()
	port.report({ type: 'SCROLL' })
	port.report({ type: 'SCROLL' })
	port.report({ type: 'INTERACT', eligible: true })
	expect(reports).toEqual([{ type: 'INTERACT', attachmentId: 'current' }])
	expect(requestAnimationFrame).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(1)
	expect(port.measure).toHaveBeenCalledOnce()
	expect(reports.at(-1)).toEqual({ type: 'MEASURE', attachmentId: 'current', position })
	actor.stop()
	expect(port.dispose).toHaveBeenCalledOnce()
})
it('ignores initial and repeated sizes but reports a real resize once', () => {
	const port = fixture(),
		{ actor, reports } = owner(port.viewport)
	port.report({ type: 'RESIZE', sizes: [{ width: 800, height: 600 }] })
	expect(reports).toEqual([])
	port.report({ type: 'RESIZE', sizes: [{ width: 700, height: 600 }] })
	port.report({ type: 'RESIZE', sizes: [{ width: 700, height: 600 }] })
	expect(reports).toEqual([{ type: 'RESIZE', attachmentId: 'current' }])
	actor.stop()
})
it('cancels a pending frame and releases the source before restoration, ignoring stale callbacks', async () => {
	const port = fixture(),
		{ actor, reports } = owner(port.viewport)
	port.report({ type: 'SCROLL' })
	actor.send({ type: 'RESTORE' })
	expect(port.dispose).toHaveBeenCalledOnce()
	port.report({ type: 'INTERACT', eligible: true })
	await vi.advanceTimersByTimeAsync(1)
	expect(port.measure).not.toHaveBeenCalled()
	expect(port.restore).toHaveBeenCalledExactlyOnceWith(position)
	expect(reports).toEqual([])
	await vi.advanceTimersByTimeAsync(1)
	expect(reports).toEqual([{ type: 'RESTORED', attachmentId: 'current' }])
	actor.stop()
})
it('does not measure or restore after its owner is stopped', async () => {
	const port = fixture(),
		{ actor, reports } = owner(port.viewport)
	port.report({ type: 'SCROLL' })
	actor.stop()
	port.report({ type: 'SCROLL' })
	await vi.advanceTimersByTimeAsync(5)
	expect(port.measure).not.toHaveBeenCalled()
	expect(reports).toEqual([])
	const restoring = owner(port.viewport, 'restoring')
	restoring.actor.stop()
	await vi.advanceTimersByTimeAsync(5)
	expect(port.restore).not.toHaveBeenCalled()
	expect(restoring.reports).toEqual([])
})
it('reports an empty measurement without a fabricated position and releases resources on a measurement failure', async () => {
	const port = fixture(),
		{ actor, reports } = owner(port.viewport)
	port.measure.mockReturnValueOnce(undefined)
	port.report({ type: 'SCROLL' })
	await vi.advanceTimersByTimeAsync(1)
	expect(reports).toEqual([])
	port.measure.mockImplementationOnce(() => {
		throw new Error('Geometry failed')
	})
	port.report({ type: 'SCROLL' })
	await vi.advanceTimersByTimeAsync(1)
	expect(reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	expect(port.dispose).toHaveBeenCalledOnce()
	actor.stop()
})
it('reports observation startup and restoration failures through the owning reader', async () => {
	const port = fixture()
	const failed = owner({
		...port.viewport,
		observe: () => {
			throw new Error('Observation failed')
		}
	})
	expect(failed.reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	failed.actor.stop()
	port.restore.mockImplementationOnce(() => {
		throw new Error('Restore failed')
	})
	const restoring = owner(port.viewport, 'restoring')
	await vi.advanceTimersByTimeAsync(3)
	expect(restoring.reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	restoring.actor.stop()
	port.measure.mockImplementation(() => {
		throw new Error('Detached geometry')
	})
	expect(finalReadingPosition(port.viewport, position)).toBe(position)
})
it('releases observation when an animation frame cannot be acquired', () => {
	const port = fixture(),
		{ actor, reports } = owner(port.viewport)
	vi.mocked(requestAnimationFrame).mockImplementationOnce(() => {
		throw new Error('Frame unavailable')
	})
	port.report({ type: 'SCROLL' })
	expect(reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	expect(port.dispose).toHaveBeenCalledOnce()
	actor.stop()
})
