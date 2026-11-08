import { defineConfig } from '@playwright/test'
export default defineConfig({
	testDir: './apps/web/tests/worker',
	workers: 1,
	fullyParallel: false,
	timeout: 45000,
	use: { baseURL: 'http://127.0.0.1:5480', trace: 'off', screenshot: 'off' },
	webServer: {
		command: 'pnpm --filter @delightful-clipper/web dev --port 5480',
		url: 'http://127.0.0.1:5480',
		reuseExistingServer: false,
		timeout: 60000,
		env: {
			CLIPPER_TEST: 'true',
			CLIPPER_TEST_WORKER: 'true',
			PUBLIC_FAKE_DATA: 'false',
			PUBLIC_DEBUG: 'true',
			CAPTURE_GATEWAY_ENABLED: 'false',
			PUBLIC_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
			PUBLIC_JAZZ_SERVER_URL: 'same-origin'
		}
	}
})
