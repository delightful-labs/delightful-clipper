import { defineEnvVars } from '@sveltejs/kit/env'
import { z } from 'zod'

export const variables = defineEnvVars({
	PUBLIC_FAKE_DATA: {
		public: true,
		static: true,
		schema: z.enum(['true', 'false']).default('false')
	},
	PUBLIC_DEBUG: { public: true, static: true, schema: (value) => value ?? '' },
	CAPTURE_GATEWAY_ENABLED: { public: true, static: true, schema: (value) => value === 'true' },
	JAZZ_ACCOUNT_REGISTRY: { static: true, schema: (value) => value ?? '' },
	PUBLIC_JAZZ_APP_ID: { public: true, static: true, schema: (value) => value ?? '' },
	PUBLIC_JAZZ_SERVER_URL: { public: true, static: true, schema: (value) => value ?? '' }
})
