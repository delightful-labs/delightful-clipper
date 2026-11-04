import { it, expect, vi } from 'vitest'
import { readCaptureResponse } from './article-worker-io.js'
const call = {
	type: 'CALL' as const,
	id: 'rpc',
	method: 'resolve' as const,
	url: 'https://example.com/',
	requestId: 'operation'
}
it('returns bounded response bytes and status without parsing source data on the main thread', async () => {
	const signal = new AbortController().signal
	const request = vi.fn(async () => new Response('{"code":"permissionDenied"}', { status: 403 }))
	const result = await readCaptureResponse(request, call, signal, () => true)
	expect(result).toEqual({
		method: 'resolve',
		status: 403,
		bytes: new TextEncoder().encode('{"code":"permissionDenied"}')
	})
	expect(request).toHaveBeenCalledWith(
		'resolve',
		{ protocolVersion: 1, operationId: 'operation', url: call.url },
		signal
	)
})
it('cancels an oversized response body before releasing its reader', async () => {
	const cancel = vi.fn()
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1))
		},
		cancel
	})
	await expect(
		readCaptureResponse(
			async () => new Response(body),
			call,
			new AbortController().signal,
			() => true
		)
	).rejects.toThrow('sourceTooLarge')
	expect(cancel).toHaveBeenCalledOnce()
	expect(body.locked).toBe(false)
})
it('drains a late response after cancellation instead of leaking its body', async () => {
	const response = Promise.withResolvers<Response>(),
		controller = new AbortController(),
		cancel = vi.fn()
	const body = new ReadableStream<Uint8Array>({ cancel })
	const result = readCaptureResponse(
		() => response.promise,
		call,
		controller.signal,
		() => true
	)
	controller.abort()
	response.resolve(new Response(body))
	await expect(result).rejects.toThrow()
	expect(cancel).toHaveBeenCalledOnce()
	expect(body.locked).toBe(false)
})
