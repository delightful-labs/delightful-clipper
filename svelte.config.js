import adapter from '@sveltejs/adapter-netlify'
import path from 'path'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
    vite: {
      resolve: {
        alias: {
          '$components': path.resolve('./src/lib/components'),
        },
      },
    },
	}
};

export default config
