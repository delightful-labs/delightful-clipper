import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createGatewayMachine } from './gateway.js'
import type { Hop } from '../../server/capture/transport.js'
import { CaptureError } from '../../server/capture/errors.js'
function fixture() {
	return {
		resolve: vi.fn(async () => ({ address: '8.8.8.8', family: 4 })),
		fetch: vi.fn(async (): Promise<Hop> => ({
			status: 200,
			location: undefined,
			mediaType: 'text/html',
			body: new Uint8Array([1])
		})),
		extract: vi.fn(() => ({
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
		}))
	}
}
const input: () => { url: string; mode: 'extract'; signal: AbortSignal } = () => ({
	url: 'https://example.com/',
	mode: 'extract',
	signal: new AbortController().signal
})
it('revalidates and pins each redirect before fetching, then releases response buffers', async () => {
	const deps = fixture()
	deps.fetch.mockResolvedValueOnce({
		status: 302,
		location: 'https://second.example/article',
		mediaType: '',
		body: new Uint8Array()
	})
	const actor = createActor(createGatewayMachine(deps), { input: input() }).start()
	const result = await toPromise(actor)
	expect(result.kind).toBe('success')
	expect(deps.resolve.mock.calls.length).toBe(2)
	expect(deps.fetch.mock.calls.length).toBe(2)
	expect(deps.extract).toHaveBeenCalledTimes(1)
	expect(actor.getSnapshot().context.hop).toBeUndefined()
})
it('rejects a private redirect without sending a second upstream request', async () => {
	const deps = fixture()
	deps.fetch.mockResolvedValueOnce({
		status: 302,
		location: 'http://127.0.0.1/',
		mediaType: '',
		body: new Uint8Array()
	})
	deps.resolve
		.mockResolvedValueOnce({ address: '8.8.8.8', family: 4 })
		.mockRejectedValueOnce(new CaptureError('redirectBlocked', 400))
	const result = await toPromise(
		createActor(createGatewayMachine(deps), { input: input() }).start()
	)
	expect(result.kind).toBe('failed')
	expect(deps.fetch).toHaveBeenCalledTimes(1)
	expect(deps.extract).not.toHaveBeenCalled()
})
it('bounds redirect loops without extraction', async () => {
	const deps = fixture()
	deps.fetch.mockResolvedValue({
		status: 302,
		location: 'https://example.com/',
		mediaType: '',
		body: new Uint8Array()
	})
	const result = await toPromise(
		createActor(createGatewayMachine(deps), { input: input() }).start()
	)
	expect(result.kind).toBe('failed')
	expect(deps.fetch).toHaveBeenCalledTimes(1)
})
it('does not extract or publish a response after request cancellation', async () => {
	const deps = fixture(),
		controller = new AbortController()
	deps.fetch.mockImplementation(async () => {
		controller.abort()
		return { status: 200, location: undefined, mediaType: 'text/html', body: new Uint8Array([1]) }
	})
	const result = await toPromise(
		createActor(createGatewayMachine(deps), {
			input: { ...input(), signal: controller.signal }
		}).start()
	)
	expect(result.kind).toBe('failed')
	expect(deps.extract).not.toHaveBeenCalled()
})

it('keeps an issued fetch owned until explicit cancellation settles', async () => {
	const deps = fixture()
	let finish!: (value: Hop) => void
	deps.fetch.mockImplementation(
		() =>
			new Promise<Hop>((resolve) => {
				finish = resolve
			})
	)
	const actor = createActor(createGatewayMachine(deps), { input: input() }).start()
	await new Promise<void>((resolve) => {
		const subscription = actor.subscribe((snapshot) => {
			if (snapshot.matches('fetching')) {
				subscription.unsubscribe()
				resolve()
			}
		})
	})
	actor.send({ type: 'CANCEL' })
	expect(actor.getSnapshot().status).toBe('active')
	finish({ status: 200, location: undefined, mediaType: 'text/html', body: new Uint8Array() })
	const result = await toPromise(actor)
	expect(result.kind).toBe('failed')
	expect(deps.extract).not.toHaveBeenCalled()
})
