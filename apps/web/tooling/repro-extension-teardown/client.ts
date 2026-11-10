import { createJazzClient } from 'jazz-tools/client'
import { exportLocalFirstSecret } from 'jazz-tools'
import { app } from './schema.ts'

const config: {
	serverUrl: string | null
	restore: boolean
	subscribe: boolean
	localFirst: boolean
} = JSON.parse(document.getElementById('fixture-config')!.textContent!)
const stage = (value: string) => {
	document.body.dataset.stage = value
}
stage('opening')
const session = await createJazzClient({
	serverUrl: config.serverUrl,
	env: 'extension-teardown-repro',
	initial: 'local-first',
	...(config.localFirst ? { client: () => import('jazz-tools/local-first') } : {}),
	runtimeSources: {
		wasmUrl: new URL('./jazz_wasm_bg.wasm', location.href).href,
		brokerWorkerUrl: new URL('./jazz-broker-worker.js', location.href).href,
		wasmVersion: '2.0.0-alpha.60'
	}
})
while (
	session.getSnapshot().status !== 'ready' ||
	(config.localFirst && !session.getSnapshot().client?.db.isLocalFirst())
) {
	await new Promise((resolve) => setTimeout(resolve, 10))
}
if (config.restore) {
	stage('restoring')
	const secret = exportLocalFirstSecret(session.getSnapshot().account!)
	await session.createLocalFirst()
	await session.restoreLocalFirst(secret)
}
const db = session.getSnapshot().client!.db
const ownerId = session.getSnapshot().account!.id
stage('writing')
await db
	.upsert(app.items, crypto.randomUUID(), { ownerId, title: 'Disposable fixture' })
	.wait({ tier: config.serverUrl === null ? 'local' : 'global' })
let release = () => {}
if (config.subscribe) {
	stage('subscribing')
	await new Promise<void>((resolve, reject) => {
		release = db.subscribe(app.items.where({ ownerId }), {
			onUpdate: () => resolve(),
			onError: reject
		})
	})
}
declare global {
	var jazzExtensionTeardownFinish: (mode: string) => Promise<void>
}
globalThis.jazzExtensionTeardownFinish = async (mode: string) => {
	if (mode === 'unsubscribe' || mode === 'session') release()
	if (mode === 'session') await session.close()
	if (mode === 'disconnect') await db.disconnect()
}
stage('ready')
