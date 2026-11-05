import { defineConfig } from '@playwright/test'
export default defineConfig({
	testDir: './apps/web/tests/fake-data',
	workers: 1,
	fullyParallel: false,
	timeout: 60000,
	use: { baseURL: 'http://127.0.0.1:5182', trace: 'off', screenshot: 'off' },
	webServer: {
		command: 'pnpm --filter @delightful-clipper/web dev --port 5182',
		url: 'http://127.0.0.1:5182',
		reuseExistingServer: false,
		timeout: 60000,
		env: {
			CLIPPER_TEST: 'true',
			PUBLIC_FAKE_DATA: 'true',
			PUBLIC_DEBUG: 'false',
			CAPTURE_GATEWAY_ENABLED: 'true',
			PUBLIC_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
			PUBLIC_JAZZ_SERVER_URL: 'http://127.0.0.1:5183',
			JAZZ_ACCOUNT_REGISTRY:
				'http://127.0.0.1:5183/apps/2db98ae3-fcf1-41e8-b7d3-9818496bde60/accounts'
		}
	}
})
