import { defineConfig } from 'vitest/config'
export default defineConfig({
	test: {
		include: ['apps/web/src/lib/**/*.test.ts', 'apps/web/tooling/**/*.test.ts'],
		testTimeout: 15000,
		hookTimeout: 15000
	}
})
