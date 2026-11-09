import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createJazzClient } from 'jazz-tools/backend'
import { exportLocalFirstSecret } from 'jazz-tools'
import type { AccountStore } from 'jazz-tools'
import { app, permissions } from './src/lib/model.ts'

const target = process.env.JAZZ_PROOF_URL
assert.ok(target, 'Set JAZZ_PROOF_URL to the isolated proof deployment URL')
const admission = await fetch(new URL('/proof.json', target), {
	redirect: 'error',
	signal: AbortSignal.timeout(15_000)
})
assert.equal(admission.status, 200, 'Proof deployment must be reachable before creating a client')
const manifest: unknown = await admission.json()
assert.ok(
	manifest &&
		typeof manifest === 'object' &&
		'kind' in manifest &&
		manifest.kind === 'delightful-vercel-jazz-proof',
	'Refuse a deployment that is not the isolated proof'
)
const endpoint = new URL('/jazz', target)
assert.ok(endpoint.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(endpoint.hostname))
const owners = new Set<Awaited<ReturnType<typeof createJazzClient>>>()
let cleanup: PromiseSettledResult<void>[] = []
function memoryStore(): AccountStore {
	let value: string | null = null
	return {
		read: async () => value,
		update: async (transform) => {
			value = transform(value)
		}
	}
}
async function open(initial?: 'local-first') {
	const owner = await createJazzClient({
		app,
		permissions,
		serverUrl: endpoint.href,
		driver: { type: 'memory' },
		store: memoryStore(),
		...(initial ? { initial } : {})
	})
	owners.add(owner)
	return owner
}
try {
	const first = await open('local-first')
	const original = first.getSnapshot()
	assert.equal(original.status, 'ready')
	assert.ok(original.account && original.client)
	const id = randomUUID()
	const text = `Synthetic Vercel proof ${randomUUID()}`
	const write = original.client.db.upsert(app.records, id, { ownerId: original.account.id, text })
	await write.wait({ tier: 'local', timeoutMs: 20_000 })
	console.info('PASS: local save acknowledged')
	await write.wait({ tier: 'global', timeoutMs: 60_000 })
	console.info('PASS: remote save acknowledged')
	const restored = await open()
	await restored.restoreLocalFirst(exportLocalFirstSecret(original.account))
	const replica = restored.getSnapshot()
	assert.ok(replica.client)
	assert.equal(
		(await replica.client.db.one(app.records.where({ id }), { tier: 'remote' }))?.text,
		text
	)
	console.info('PASS: restored identity reads the same record through a second client')
	const unrelated = await open('local-first')
	const other = unrelated.getSnapshot()
	assert.ok(other.client)
	assert.equal(await other.client.db.one(app.records.where({ id }), { tier: 'remote' }), null)
	console.info('PASS: unrelated identity cannot read that record')
	const runMinutes = Number(process.env.JAZZ_PROOF_RUN_MINUTES ?? '0')
	assert.ok(Number.isFinite(runMinutes) && runMinutes >= 0 && runMinutes <= 60)
	const started = Date.now()
	while (Date.now() - started < runMinutes * 60_000) {
		await delay(Math.min(30_000, runMinutes * 60_000 - (Date.now() - started)))
		const text = `Reconnect check ${Date.now()}`
		await original.client.db
			.update(app.records, id, { text })
			.wait({ tier: 'global', timeoutMs: 60_000 })
		assert.equal(
			(await replica.client.db.one(app.records.where({ id }), { tier: 'remote' }))?.text,
			text
		)
		console.info(
			`PASS: remote write/read after ${Math.round((Date.now() - started) / 1000)} seconds`
		)
	}
	if (process.env.JAZZ_PROOF_SLEEP_WAKE === 'true') {
		const secret = exportLocalFirstSecret(original.account)
		const expected = (await original.client.db.one(app.records.where({ id }), { tier: 'remote' }))
			?.text
		await Promise.all([...owners].map((owner) => owner.close({ timeoutMs: 10_000 })))
		owners.clear()
		// The proof core's idle timeout is one minute. No requests during this wait.
		await delay(120_000)
		const resumed = await open()
		await resumed.restoreLocalFirst(secret)
		const snapshot = resumed.getSnapshot()
		assert.ok(snapshot.client)
		assert.equal(
			(await snapshot.client.db.one(app.records.where({ id }), { tier: 'remote' }))?.text,
			expected
		)
		console.info(
			'PASS: acknowledged data survived a two-minute quiet interval and fresh-client recovery'
		)
	}
} finally {
	cleanup = await Promise.allSettled([...owners].map((owner) => owner.close({ timeoutMs: 10_000 })))
}

for (const result of cleanup)
	if (result.status === 'rejected') throw new Error('Proof client cleanup failed')
