import { spawnSync } from 'node:child_process'
const result = spawnSync(
	'pnpm',
	['--filter', '@delightful-clipper/extension', 'build', '--outDir', '.test-build'],
	{
		stdio: 'inherit',
		env: {
			...process.env,
			PUBLIC_DEBUG: 'true',
			EXTENSION_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
			EXTENSION_JAZZ_SERVER_URL: 'http://127.0.0.1:5180/jazz',
			EXTENSION_WEB_URL: 'http://127.0.0.1:5180'
		}
	}
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
