import adapter from '@sveltejs/adapter-netlify'
import preprocess from 'svelte-preprocess'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: preprocess(),
	kit: {
		adapter: adapter(),
		version: {
      name: Date.now().toString(), // default to timestamp
      pollInterval: 60_000 // default to checking once a minute
    }
	}
};

export default config;
