import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-vercel'
export default defineConfig({
	plugins: [
		sveltekit({ adapter: adapter({ runtime: 'nodejs24.x', regions: ['iad1'], maxDuration: 300 }) })
	],
	ssr: { external: ['jazz-napi', 'jazz-tools', '@vercel/functions', '@vercel/sandbox', 'ws'] },
	server: { host: '0.0.0.0', strictPort: true }
})
