import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'
export default defineConfig({
	...base,
	testIgnore: [],
	testMatch: 'schema-upgrade.spec.ts',
	webServer: {
		command: 'pnpm --filter @delightful-clipper/web dev --port 5180',
		url: 'http://127.0.0.1:5180',
		reuseExistingServer: false,
		timeout: 60000,
		env: {
			CLIPPER_TEST: 'true',
			CLIPPER_TEST_MIGRATIONS: 'true',
			CLIPPER_TEST_EXTERNAL_JAZZ: 'true',
			PUBLIC_FAKE_DATA: 'false',
			PUBLIC_DEBUG: 'true',
			CAPTURE_GATEWAY_ENABLED: 'true',
			PUBLIC_JAZZ_APP_ID: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
			PUBLIC_JAZZ_SERVER_URL: 'http://127.0.0.1:5181/jazz'
		}
	}
})
