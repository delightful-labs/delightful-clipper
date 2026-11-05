import { defineConfig } from '@playwright/test'
export default defineConfig({
	testDir: './apps/extension/tests',
	workers: 1,
	fullyParallel: false,
	timeout: 60000,
	use: { baseURL: 'http://127.0.0.1:5180', trace: 'off', screenshot: 'off' },
	webServer: {
		command: 'pnpm --filter @delightful-clipper/web dev --port 5180',
		url: 'http://127.0.0.1:5180',
		reuseExistingServer: false,
		timeout: 60000,
		env: {
			CLIPPER_TEST: 'true',
			PUBLIC_FAKE_DATA: 'false',
			PUBLIC_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
			PUBLIC_JAZZ_SERVER_URL: 'http://127.0.0.1:5181',
			JAZZ_ACCOUNT_REGISTRY:
				'http://127.0.0.1:5181/apps/2db98ae3-fcf1-41e8-b7d3-9818496bde60/accounts',
			CAPTURE_GATEWAY_ENABLED: 'true'
		}
	}
})
