import { expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { parserWorkerMachine } from './parser-worker.js'
import type { WorkerEvent } from './parser-worker.js'
import type { ExtractedContent, ParserReply } from '../../server/capture/parser-protocol.js'
const content: ExtractedContent = {
	canonicalCandidate: undefined,
	candidate: {
		title: 'Title',
		author: undefined,
		html: '<p>Text</p>',
		text: 'Text',
		headings: [],
		footnotes: [],
		assetCandidates: [],
		parserVersion: 'test',
		normalizationVersion: '1',
		partialEvidence: []
	}
}
const reply: ParserReply = { kind: 'success', value: content }
function fixture() {
	const clock = new SimulatedClock(),
		terminate = vi.fn(),
		release = vi.fn()
	let report: ((event: WorkerEvent) => void) | undefined
	const actor = createActor(parserWorkerMachine, {
		clock,
		input: {
			open: (send) => {
				report = send
				return { terminate, release }
			}
		}
	}).start()
	const emit = (event: WorkerEvent) => {
		if (!report) throw new Error('Worker not acquired')
		report(event)
	}
	return { actor, clock, terminate, release, emit }
}
it('waits for exit after a reply, then releases the resource and clears provisional content', async () => {
	const { actor, emit, terminate, release } = fixture()
	emit({ type: 'WORKER_RESULT', reply })
	expect(actor.getSnapshot().matches({ active: 'stopping' })).toBe(true)
	expect(actor.getSnapshot().status).toBe('active')
	expect(terminate).toHaveBeenCalledOnce()
	expect(release).not.toHaveBeenCalled()
	emit({ type: 'WORKER_EXIT' })
	expect(await toPromise(actor)).toEqual(reply)
	expect(release).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context).toMatchObject({
		open: undefined,
		reply: undefined,
		failure: undefined
	})
	expect(Object.keys(actor.getSnapshot().children)).toEqual([])
})
it('cancellation wins over a reply while termination is pending', async () => {
	const { actor, emit } = fixture()
	emit({ type: 'WORKER_RESULT', reply })
	actor.send({ type: 'CANCEL' })
	emit({ type: 'WORKER_EXIT' })
	expect(await toPromise(actor)).toMatchObject({ kind: 'failed', code: 'canceled', status: 408 })
})
it('enforces the deadline through worker exit and ignores late replies and errors', async () => {
	const { actor, clock, emit, release } = fixture()
	clock.increment(10000)
	expect(actor.getSnapshot().matches({ active: 'stopping' })).toBe(true)
	expect(release).not.toHaveBeenCalled()
	emit({ type: 'WORKER_RESULT', reply })
	emit({ type: 'WORKER_ERROR', code: 'ERR_WORKER_OUT_OF_MEMORY' })
	emit({ type: 'WORKER_EXIT' })
	expect(await toPromise(actor)).toMatchObject({
		kind: 'failed',
		code: 'parseTimeout',
		status: 504
	})
	expect(release).toHaveBeenCalledOnce()
})
it('retains cancellation when the termination wait crosses the deadline', async () => {
	const { actor, clock, emit } = fixture()
	actor.send({ type: 'CANCEL' })
	clock.increment(10000)
	emit({ type: 'WORKER_ERROR', code: 'UNKNOWN' })
	emit({ type: 'WORKER_EXIT' })
	expect(await toPromise(actor)).toMatchObject({ code: 'canceled', status: 408 })
})
it('does not confirm a reply whose worker fails to exit before the deadline', async () => {
	const { actor, clock, emit } = fixture()
	clock.increment(9999)
	emit({ type: 'WORKER_RESULT', reply })
	clock.increment(1)
	emit({ type: 'WORKER_EXIT' })
	expect(await toPromise(actor)).toMatchObject({ code: 'parseTimeout', status: 504 })
})
it.each([
	['ERR_WORKER_OUT_OF_MEMORY', 'sourceTooLarge', 413],
	['UNKNOWN', 'gatewayUnavailable', 503]
] as const)('drains worker error %s before reporting failure', async (code, outcome, status) => {
	const { actor, emit, release } = fixture()
	emit({ type: 'WORKER_ERROR', code })
	expect(actor.getSnapshot().status).toBe('active')
	expect(release).not.toHaveBeenCalled()
	emit({ type: 'WORKER_EXIT' })
	expect(await toPromise(actor)).toMatchObject({ code: outcome, status })
})
it('treats an exit without a reply as unavailable', async () => {
	const { actor, emit } = fixture()
	emit({ type: 'WORKER_EXIT' })
	expect(await toPromise(actor)).toMatchObject({ code: 'gatewayUnavailable', status: 503 })
})
it('reports startup failure without waiting for an unacquired resource', async () => {
	const actor = createActor(parserWorkerMachine, {
		input: {
			open: () => {
				throw new Error('Cannot start')
			}
		}
	}).start()
	expect(await toPromise(actor)).toMatchObject({ code: 'gatewayUnavailable', status: 503 })
})
it('releases the resource if its owner is forcibly stopped', () => {
	const { actor, release } = fixture()
	actor.stop()
	expect(release).toHaveBeenCalledOnce()
})
