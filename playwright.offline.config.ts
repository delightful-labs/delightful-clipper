import { defineConfig } from '@playwright/test'
export default defineConfig({
	testDir: './apps/web/tests/offline',
	fullyParallel: false,
	workers: 1,
	timeout: 60000,
	use: { baseURL: 'http://127.0.0.1:5190', trace: 'off', screenshot: 'off' }
})
