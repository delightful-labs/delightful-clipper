import { afterEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createActor } from 'xstate'
import { codeElements, installSyntaxRanges } from './native.js'
import { syntaxSurfaceMachine, type SyntaxWorker } from './surface-machine.js'
import type { CodeBlock } from './schema.js'

class TestWorker implements SyntaxWorker {
	onmessage: SyntaxWorker['onmessage'] = null
	onerror: SyntaxWorker['onerror'] = null
	onmessageerror: SyntaxWorker['onmessageerror'] = null
	postMessage = vi.fn<(blocks: CodeBlock[]) => void>()
	terminate = vi.fn<() => void>()
}

const cleanup: (() => void)[] = []
afterEach(() => {
	for (const release of cleanup.splice(0).reverse()) release()
	vi.useRealTimers()
	vi.restoreAllMocks()
})

function fixture() {
	const dom = new JSDOM(
		'<article><pre><code class="language-js">const value = "🦊";</code></pre></article>'
	)
	cleanup.push(() => dom.window.close())
	const root = dom.window.document.querySelector('article')!
	const registry = new Map<string, Set<Range>>()
	Object.defineProperties(dom.window, {
		CSS: { value: { highlights: registry } },
		Highlight: { value: Set }
	})
	const worker = new TestWorker()
	const actor = createActor(syntaxSurfaceMachine, {
		input: {
			root,
			elements: codeElements(root),
			supported: true,
			ranges: [],
			createWorker: () => worker
		}
	})
	cleanup.push(() => actor.stop())
	return { dom, root, registry, worker, actor }
}

it('colors original text nodes and releases only owned ranges, preserving other highlight users', async () => {
	const { root, registry, worker, actor } = fixture()
	const original = root.querySelector('code')!.firstChild!
	const existing = root.ownerDocument.createRange()
	existing.selectNodeContents(root)
	const shared = new Set([existing])
	registry.set('storage', shared)
	actor.start()
	await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
	worker.onmessage?.(
		new MessageEvent('message', {
			data: { kind: 'ready', ranges: [{ block: 0, category: 'storage', start: 0, end: 5 }] }
		})
	)
	expect(actor.getSnapshot().matches('highlighted')).toBe(true)
	expect(worker.terminate).toHaveBeenCalledOnce()
	expect(root.querySelector('code')!.firstChild).toBe(original)
	expect([...shared].map((range) => range.toString())).toContain('const')
	actor.stop()
	expect(registry.get('storage')).toBe(shared)
	expect([...shared]).toEqual([existing])
})

it('terminates pending tokenization and ignores late results after the reader leaves', async () => {
	const { registry, worker, actor } = fixture()
	actor.start()
	await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
	const late = worker.onmessage!
	actor.stop()
	expect(worker.terminate).toHaveBeenCalledOnce()
	expect(worker.onmessage).toBeNull()
	late(
		new MessageEvent('message', {
			data: { kind: 'ready', ranges: [{ block: 0, category: 'storage', start: 0, end: 5 }] }
		})
	)
	expect(registry.size).toBe(0)
})

it('uses plain text after a deadline and releases the worker', async () => {
	vi.useFakeTimers()
	const { worker, actor, registry } = fixture()
	actor.start()
	await vi.advanceTimersByTimeAsync(5000)
	expect(actor.getSnapshot().matches('plain')).toBe(true)
	expect(worker.terminate).toHaveBeenCalledOnce()
	expect(registry.size).toBe(0)
})

it('rejects malformed or mismatched output before registering native ranges', async () => {
	const { worker, actor, registry } = fixture()
	actor.start()
	await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
	worker.onmessage?.(
		new MessageEvent('message', {
			data: { kind: 'ready', ranges: [{ block: 1, category: 'storage', start: 0, end: 5 }] }
		})
	)
	expect(actor.getSnapshot().matches('plain')).toBe(true)
	expect(worker.terminate).toHaveBeenCalledOnce()
	expect(registry.size).toBe(0)
})

it('leaves unsupported browsers plain without constructing a worker', () => {
	const { root, worker, actor } = fixture()
	const createWorker = vi.fn(() => worker)
	const unsupported = createActor(syntaxSurfaceMachine, {
		input: {
			root,
			elements: codeElements(root),
			supported: false,
			ranges: [],
			createWorker
		}
	}).start()
	cleanup.push(() => unsupported.stop())
	expect(unsupported.getSnapshot().matches('plain')).toBe(true)
	expect(createWorker).not.toHaveBeenCalled()
	actor.stop()
})

it('rolls back partial native range acquisition when a later range cannot be created', () => {
	const { root, registry } = fixture()
	const document = root.ownerDocument
	const create = document.createRange.bind(document)
	vi.spyOn(document, 'createRange')
		.mockImplementationOnce(create)
		.mockImplementationOnce(() => {
			throw new Error('Unavailable')
		})
	expect(() =>
		installSyntaxRanges(codeElements(root), [
			{ block: 0, category: 'storage', start: 0, end: 5 },
			{ block: 0, category: 'variable', start: 6, end: 11 }
		])
	).toThrow()
	expect(registry.size).toBe(0)
})

it('releases a worker whose post fails and leaves the article readable', async () => {
	const { worker, actor, root } = fixture()
	worker.postMessage.mockImplementation(() => {
		throw new Error('Cannot post')
	})
	actor.start()
	await vi.waitFor(() => expect(actor.getSnapshot().matches('plain')).toBe(true))
	expect(worker.terminate).toHaveBeenCalledOnce()
	expect(root.textContent).toBe('const value = "🦊";')
})

it('refuses ranges after the rendered content changes', () => {
	const { worker, actor, root, registry } = fixture()
	actor.start()
	root.querySelector('code')!.textContent = 'Changed article'
	worker.onmessage?.(
		new MessageEvent('message', {
			data: { kind: 'ready', ranges: [{ block: 0, category: 'storage', start: 0, end: 5 }] }
		})
	)
	expect(actor.getSnapshot().matches('plain')).toBe(true)
	expect(registry.size).toBe(0)
	expect(worker.terminate).toHaveBeenCalledOnce()
})
