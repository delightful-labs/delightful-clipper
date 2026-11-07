import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { schema as s } from 'jazz-tools'
import { acceptLocalFirstAuth, createJazz, remote, sqlite } from 'jazz-tools/backend'
import { startLocalJazzServer } from 'jazz-tools/dev'

// Fresh disposable data only; no application identities or production credentials.
const app = s.defineApp({ records: s.table({ text: s.string() }, {}) }, { migrations: 'none' })
const permissions = s.definePermissions(app, ({ policy }) => {
	policy.records.allowRead.always()
	policy.records.allowInsert.always()
})
const previousNetlify = process.env.NETLIFY
process.env.NETLIFY = 'true'
try {
	const embedded = createJazz({
		app,
		permissions,
		store: sqlite({ path: '/tmp/clipper-jazz-netlify-probe' })
	})
	try {
		await assert.rejects(embedded.ready(), /can't keep data on Netlify/)
		console.info('PASS: embedded SQLite refuses ephemeral Netlify storage')
	} finally {
		await embedded.close()
	}
	const core = await startLocalJazzServer({ host: '127.0.0.1', inMemory: true })
	const handlers = new Set<ReturnType<typeof createJazz>>()
	const open = async () => {
		const handler = createJazz({
			app,
			permissions,
			authenticate: acceptLocalFirstAuth,
			publicUrl: 'https://netlify-jazz-probe.invalid/jazz',
			store: remote({ url: core.url, appId: core.appId, secret: core.adminSecret })
		})
		handlers.add(handler)
		await handler.ready()
		return handler
	}
	try {
		const first = await open()
		const second = await open()
		const id = randomUUID()
		await first.db
			.upsert(app.records, id, { text: 'survives handler restart' })
			.wait({ tier: 'global' })
		await first.close()
		handlers.delete(first)
		const replacement = await open()
		assert.equal(
			(await replacement.db.one(app.records.where({ id })))?.text,
			'survives handler restart'
		)
		console.info('PASS: remote-core data survives handler close and replacement')
		const base = `https://netlify-jazz-probe.invalid/jazz/apps/${core.appId}`
		const socket = await replacement.handle(new Request(`${base}/ws`))
		assert.equal(socket.status, 426)
		assert.equal(socket.headers.get('x-jazz-stream'), '1')
		console.info('PASS: fetch handler advertises HTTP streaming without WebSocket upgrades')
		const stream = await replacement.handle(new Request(`${base}/stream`, { method: 'POST' }))
		assert.equal(stream.status, 200)
		const reader = stream.body!.getReader()
		try {
			const record = (await reader.read()).value!
			assert.equal(record[0], 0)
			const length = new DataView(record.buffer, record.byteOffset).getUint32(1, false)
			const session: { id: string; key: string } = JSON.parse(
				new TextDecoder().decode(record.slice(5, 5 + length))
			)
			const request = () =>
				new Request(`${base}/stream/${session.id}`, {
					method: 'DELETE',
					headers: { 'x-jazz-stream-key': session.key }
				})
			const differentInstance = await second.handle(request())
			assert.equal(differentInstance.status, 404)
			assert.match(await differentInstance.text(), /single backend instance or sticky routing/)
			assert.equal((await replacement.handle(request())).status, 204)
			console.info(
				'CONFIRMED BLOCKER: another handler cannot serve the stream even with the same remote core'
			)
		} finally {
			await reader.cancel()
		}
	} finally {
		await Promise.allSettled([...handlers].map((handler) => handler.close()))
		await core.stop()
	}
} finally {
	if (previousNetlify === undefined) delete process.env.NETLIFY
	else process.env.NETLIFY = previousNetlify
}
