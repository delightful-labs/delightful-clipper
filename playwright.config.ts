import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './apps/web/tests',
	fullyParallel: false,
	workers: 1,
	timeout: 45000,
	use: { baseURL: 'http://127.0.0.1:5180', trace: 'off', screenshot: 'off' },
	webServer: {
		command: 'pnpm --filter @delightful-clipper/web dev --port 5180',
		url: 'http://127.0.0.1:5180',
		reuseExistingServer: false,
		env: {
			CLIPPER_TEST: 'true',
			JAZZ_ACCOUNT_REGISTRY:
				'http://127.0.0.1:5181/apps/2db98ae3-fcf1-41e8-b7d3-9818496bde60/accounts',
			PUBLIC_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
			PUBLIC_JAZZ_SERVER_URL: 'http://127.0.0.1:5181'
		},
		timeout: 60000
	}
})
