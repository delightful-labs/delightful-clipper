import { z } from 'zod'
import {
	createOAuthAttemptMachine,
	type OAuthAttemptInput
} from 'delightful-local-first/identity/oauth/workflow'
import { t } from '../../localization/index.js'

async function requestJSON(path: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(path, {
		...init,
		credentials: 'same-origin',
		cache: 'no-store',
		redirect: 'error'
	})
	if (!response.ok) throw new Error('Authentication request failed')
	return response.json()
}
function tokenSource(userId: string, origin: string) {
	return {
		getToken: async () => {
			const { token } = tokenSchema.parse(await requestJSON('/api/auth/token', { method: 'GET' }))
			const payload = token.split('.')[1]
			if (!payload) throw new Error('Authentication token unavailable')
			const claims = claimsSchema.parse(
				JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')))
			)
			if (claims.sub !== userId || claims.iss !== origin || claims.aud !== origin)
				throw new Error('Authentication identity changed')
			return token
		}
	}
}

const completionSchema = z.object({ attemptId: z.uuid(), userId: z.string().min(1) })
const tokenSchema = z.object({ token: z.string().min(1) })
const claimsSchema = z.object({ sub: z.string(), iss: z.string(), aud: z.string() })
export const atprotoMachine = createOAuthAttemptMachine({
	working: { name: t('account.status.working'), variant: 'info' },
	failed: { name: t('account.feedback.identityFailed'), variant: 'error' }
})
export type AtprotoInput = Pick<OAuthAttemptInput, 'storage' | 'navigate' | 'dispatch'> & {
	origin: string
}
export function atprotoInput(input: AtprotoInput): OAuthAttemptInput {
	return {
		storage: input.storage,
		navigate: input.navigate,
		dispatch: input.dispatch,
		storageKey: 'clipper.atproto.pending.v1',
		authorize: async (handle, attemptId, signal) => {
			const body = await requestJSON('/api/auth/sign-in/atproto', {
				method: 'POST',
				signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ handle, callbackURL: '/?atproto_attempt=' + attemptId })
			})
			return z.object({ url: z.url().refine((value) => value.startsWith('https://')) }).parse(body)
				.url
		},
		complete: async (attemptId, signal) => {
			const completion = completionSchema.parse(
				await requestJSON('/api/auth/atproto/completion', { method: 'POST', signal })
			)
			if (completion.attemptId !== attemptId) throw new Error('OAuth attempt did not complete')
			return completion.userId
		},
		tokenSource: (userId) => tokenSource(userId, input.origin)
	}
}
