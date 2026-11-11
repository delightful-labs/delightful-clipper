import { defineConfig } from '@playwright/test'
import { browserCoreSecret } from './apps/web/tests/browser-core.js'
const coreUrl = process.env.CLIPPER_TEST_CORE_URL ?? 'http://127.0.0.1:5181'
const webUrl = process.env.CLIPPER_TEST_WEB_URL ?? 'http://127.0.0.1:5180'
export default defineConfig({
	testDir: './apps/extension/tests',
	workers: 1,
	fullyParallel: false,
	timeout: 60000,
	use: { baseURL: webUrl, trace: 'off', screenshot: 'off' },
	webServer: {
		command: `pnpm --filter @delightful-clipper/web dev --port ${new URL(webUrl).port}`,
		url: webUrl,
		reuseExistingServer: false,
		timeout: 60000,
		env: {
			CLIPPER_TEST: 'true',
			CLIPPER_TEST_CORE_URL: coreUrl,
			CLIPPER_TEST_CORE_SECRET: browserCoreSecret,
			PUBLIC_FAKE_DATA: 'false',
			PUBLIC_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
			PUBLIC_JAZZ_SERVER_URL: coreUrl,
			JAZZ_ACCOUNT_REGISTRY: `${coreUrl}/apps/2db98ae3-fcf1-41e8-b7d3-9818496bde60/accounts`,
			CAPTURE_GATEWAY_ENABLED: 'true'
		}
	}
})
