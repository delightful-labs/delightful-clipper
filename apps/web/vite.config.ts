import adapter from '@sveltejs/adapter-netlify'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [sveltekit({ adapter: adapter(), paths: { relative: false } })],
	server: { host: '127.0.0.1', port: 5173, strictPort: true },
	preview: { host: '127.0.0.1', port: 4173, strictPort: true }
})
