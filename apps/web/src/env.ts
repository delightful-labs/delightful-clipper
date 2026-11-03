import { defineEnvVars } from '@sveltejs/kit/env'

export const variables = defineEnvVars({
	PUBLIC_JAZZ_APP_ID: { public: true, static: true, schema: (value) => value ?? '' },
	PUBLIC_JAZZ_SERVER_URL: { public: true, static: true, schema: (value) => value ?? '' }
})
