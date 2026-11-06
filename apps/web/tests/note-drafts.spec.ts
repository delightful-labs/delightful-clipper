import { expect, test } from '@playwright/test'

test('keeps authored drafts across pages with exact acknowledgment cleanup and scoped editor keys', async ({
	page,
	context,
	baseURL
}) => {
	await page.goto(baseURL!)
	const identity = await page.evaluate(async () => {
		const path = '/src/lib/notes/drafts.ts'
		const { createNoteDraftStore }: typeof import('../src/lib/notes/drafts.js') = await import(
			/* @vite-ignore */ path
		)
		const identity = {
			namespace: crypto.randomUUID(),
			libraryId: crypto.randomUUID(),
			articleId: crypto.randomUUID(),
			writerId: crypto.randomUUID()
		}
		const store = createNoteDraftStore(identity.namespace, identity.libraryId)
		await store.write({
			writerId: identity.writerId,
			draft: {
				libraryId: identity.libraryId,
				articleId: identity.articleId,
				sequence: 1,
				text: '  literal <b>😀</b>\nhttps://example.com',
				baseRevisionIds: []
			}
		})
		return identity
	})
	const other = await context.newPage()
	await page.close()
	await other.goto(baseURL!)
	const result = await other.evaluate(async (identity) => {
		const path = '/src/lib/notes/drafts.ts'
		const { createNoteDraftStore }: typeof import('../src/lib/notes/drafts.js') = await import(
			/* @vite-ignore */ path
		)
		const store = createNoteDraftStore(identity.namespace, identity.libraryId)
		const target = { libraryId: identity.libraryId, articleId: identity.articleId }
		const reopened = await store.read(target)
		const original = reopened[0]
		if (!original) throw new Error('Missing recovered note draft')
		const newer = { ...original, draft: { ...original.draft, sequence: 2, text: 'newer text' } }
		await store.write(newer)
		await store.remove(original)
		const afterOldAcknowledgment = await store.read(target)
		const otherEditor = { ...original, writerId: crypto.randomUUID() }
		await store.write(otherEditor)
		const independentEditors = await store.read(target)
		const foreignLibraryId = crypto.randomUUID()
		const foreign = createNoteDraftStore(identity.namespace, foreignLibraryId)
		const account = await foreign.read({ ...target, libraryId: foreignLibraryId })
		const deployment = await createNoteDraftStore(crypto.randomUUID(), target.libraryId).read(
			target
		)
		const article = await store.read({ ...target, articleId: crypto.randomUUID() })
		let crossAccountRejected = false
		try {
			await foreign.write(original)
		} catch {
			crossAccountRejected = true
		}
		await store.remove(newer)
		const afterExactAcknowledgment = await store.read(target)
		await store.remove(otherEditor)
		return {
			reopened,
			afterOldAcknowledgment,
			independentEditors,
			account,
			deployment,
			article,
			crossAccountRejected,
			afterExactAcknowledgment,
			cleaned: await store.read(target)
		}
	}, identity)
	expect(result.reopened[0]?.draft.text).toBe('  literal <b>😀</b>\nhttps://example.com')
	expect(result.afterOldAcknowledgment[0]?.draft).toMatchObject({ sequence: 2, text: 'newer text' })
	expect(result.independentEditors).toHaveLength(2)
	expect(result.account).toEqual([])
	expect(result.deployment).toEqual([])
	expect(result.article).toEqual([])
	expect(result.crossAccountRejected).toBe(true)
	expect(result.afterExactAcknowledgment).toHaveLength(1)
	expect(result.afterExactAcknowledgment[0]?.writerId).not.toBe(identity.writerId)
	expect(result.cleaned).toEqual([])
})
