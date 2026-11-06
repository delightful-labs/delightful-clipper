import { expect, test } from '@playwright/test'

test('upgrades article-keyed drafts without dropping text or replacing a newer note draft', async ({
	page,
	baseURL
}) => {
	await page.goto(baseURL!)
	const result = await page.evaluate(async () => {
		const namespace = crypto.randomUUID(),
			libraryId = crypto.randomUUID(),
			articleId = crypto.randomUUID(),
			writerId = crypto.randomUUID(),
			noteId = crypto.randomUUID()
		const legacy = {
			writerId,
			draft: {
				libraryId,
				articleId,
				sequence: 4,
				text: '  recovered <b>😀</b>\n',
				baseRevisionIds: [crypto.randomUUID()]
			}
		}
		const key = JSON.stringify([namespace, libraryId, articleId, writerId])
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('delightful-clipper-note-drafts-v1', 1)
			request.onupgradeneeded = () =>
				request.result
					.createObjectStore('drafts', { keyPath: 'key' })
					.createIndex('target', 'target')
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(new Error('Legacy fixture unavailable'))
		})
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('drafts', 'readwrite')
			tx.objectStore('drafts').put({
				key,
				target: JSON.stringify([namespace, libraryId, articleId]),
				record: legacy
			})
			tx.oncomplete = () => resolve()
			tx.onabort = () => reject(new Error('Legacy fixture write failed'))
		})
		db.close()
		const path = '/src/lib/notes/drafts.ts'
		const { createNoteDraftStore }: typeof import('../src/lib/notes/drafts.js') = await import(
			/* @vite-ignore */ path
		)
		const store = createNoteDraftStore(namespace, libraryId),
			target = { libraryId, noteId }
		const before = await store.readLegacy(articleId),
			empty = await store.read(target)
		const newer = {
			writerId,
			draft: { libraryId, noteId, sequence: 5, text: 'newer note text', baseRevisionIds: [] }
		}
		await store.write(newer)
		const note = { id: noteId, libraryId, articleId, documentId: null }
		let conflictRejected = false,
			wrongAssociationRejected = false
		try {
			await store.recoverLegacy(legacy, note)
		} catch {
			conflictRejected = true
		}
		const retainedSource = await store.readLegacy(articleId),
			retainedDestination = await store.read(target)
		await store.remove(newer)
		try {
			await store.recoverLegacy(legacy, { ...note, articleId: crypto.randomUUID() })
		} catch {
			wrongAssociationRejected = true
		}
		const updatedLegacy = {
			...legacy,
			draft: { ...legacy.draft, sequence: 6, text: 'latest legacy text 😀' }
		}
		const reopened = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('delightful-clipper-note-drafts-v1', 2)
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(new Error('Legacy update unavailable'))
		})
		await new Promise<void>((resolve, reject) => {
			const tx = reopened.transaction('drafts', 'readwrite')
			tx.objectStore('drafts').put({
				key,
				target: JSON.stringify([namespace, libraryId, articleId]),
				record: updatedLegacy
			})
			tx.oncomplete = () => resolve()
			tx.onabort = () => reject(new Error('Legacy update failed'))
		})
		reopened.close()
		let staleRejected = false
		try {
			await store.recoverLegacy(legacy, note)
		} catch {
			staleRejected = true
		}
		const canonicalArticleId = crypto.randomUUID()
		await store.recoverLegacy(updatedLegacy, { ...note, articleId: canonicalArticleId }, [
			articleId,
			canonicalArticleId
		])
		return {
			before,
			empty,
			conflictRejected,
			wrongAssociationRejected,
			staleRejected,
			retainedSource,
			retainedDestination,
			recovered: await store.read(target),
			remaining: await store.readLegacy(articleId),
			legacy,
			updatedLegacy
		}
	})
	expect(result.before).toEqual([result.legacy])
	expect(result.empty).toEqual([])
	expect(result.conflictRejected).toBe(true)
	expect(result.wrongAssociationRejected).toBe(true)
	expect(result.staleRejected).toBe(true)
	expect(result.retainedSource).toEqual([result.legacy])
	expect(result.retainedDestination[0]?.draft.text).toBe('newer note text')
	expect(result.recovered[0]?.draft).toMatchObject({
		text: result.updatedLegacy.draft.text,
		sequence: 6,
		baseRevisionIds: result.legacy.draft.baseRevisionIds
	})
	expect(result.recovered[0]?.draft).not.toHaveProperty('articleId')
	expect(result.remaining).toEqual([])
})

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
			noteId: crypto.randomUUID(),
			writerId: crypto.randomUUID()
		}
		const store = createNoteDraftStore(identity.namespace, identity.libraryId)
		await store.write({
			writerId: identity.writerId,
			draft: {
				libraryId: identity.libraryId,
				noteId: identity.noteId,
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
		const target = { libraryId: identity.libraryId, noteId: identity.noteId }
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
		const article = await store.read({ ...target, noteId: crypto.randomUUID() })
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
