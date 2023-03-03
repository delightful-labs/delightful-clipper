import { sveltekit } from '@sveltejs/kit/vite'
import { resolve } from 'path'

/** @type {import('vite').UserConfig} */
const config = {
	plugins: [sveltekit()],
	resolve: {
    alias: {
      $components: resolve('./src/components')
      //$routes: resolve('./src/routes'),
      //$src: resolve('./src'),
      //$static: resolve('./static')
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      // Node.js global to browser globalThis
      // Needed for web workers
      define: {
        global: 'globalThis'
      }
    }
  }
}

export default config
