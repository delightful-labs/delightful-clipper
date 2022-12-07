import { sveltekit } from '@sveltejs/kit/vite'
import { resolve } from 'path'
import basicSsl from '@vitejs/plugin-basic-ssl'

/** @type {import('vite').UserConfig} */
const config = {
	plugins: [sveltekit(), basicSsl()],
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
