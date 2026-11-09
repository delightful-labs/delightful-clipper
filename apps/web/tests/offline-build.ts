import { spawn } from 'node:child_process'
import { cp, rm, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const target = new URL('../.offline-test-builds/', import.meta.url)
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
for (const version of ['a', 'b']) {
	await new Promise<void>((resolve, reject) => {
		const child = spawn('pnpm', ['build'], {
			cwd: root,
			stdio: 'inherit',
			env: {
				PUBLIC_FAKE_DATA: 'false',
				...process.env,
				CLIPPER_SHELL_VERSION: `offline-${version}`,
				CAPTURE_GATEWAY_ENABLED: 'true',
				PUBLIC_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
				PUBLIC_JAZZ_SERVER_URL: 'http://127.0.0.1:5190/jazz',
				JAZZ_ACCOUNT_REGISTRY:
					'http://127.0.0.1:5191/apps/2db98ae3-fcf1-41e8-b7d3-9818496bde60/accounts'
			}
		})
		child.once('error', reject)
		child.once('exit', (code) =>
			code === 0 ? resolve() : reject(new Error('Offline fixture build failed'))
		)
	})
	await cp(new URL('../build/', import.meta.url), new URL(version + '/', target), {
		recursive: true
	})
}
