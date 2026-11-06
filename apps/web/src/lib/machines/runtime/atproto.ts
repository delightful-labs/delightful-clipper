import { assign, fromPromise, setup } from 'xstate'
import { z } from 'zod'
import { t } from '../../localization/index.js'
import type { TokenIdentityCommand } from './application-readiness.js'

const key = 'clipper.atproto.pending.v1'
const intentSchema = z.object({ operation: z.enum(['connect', 'sign-in']), accountId: z.uuid() })
type Intent = z.infer<typeof intentSchema>
type ResultEvent = { type: 'TOKEN_SUCCEEDED' | 'TOKEN_FAILED' }
type Event =
	| ResultEvent
	| { type: 'RESUME'; accountId: string }
	| { type: 'BEGIN'; intent: Intent; handle: string }
	| { type: 'SHUTDOWN' }
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Input = {
	storage: IntentStorage
	origin: string
	navigate: (url: string) => void
	dispatch: (command: TokenIdentityCommand) => void
}
type Context = Input & {
	intent: Intent | undefined
	accountId: string
	handle: string
	url: string
	userId: string
}
const sessionSchema = z.object({ user: z.object({ id: z.string().min(1) }) })
const tokenSchema = z.object({ token: z.string().min(1) })
const claimsSchema = z.object({ sub: z.string(), iss: z.string(), aud: z.string() })

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
const working: { name: string; variant: 'info' } = {
	name: t('account.status.working'),
	variant: 'info'
}
const failed: { name: string; variant: 'error' } = {
	name: t('account.feedback.identityFailed'),
	variant: 'error'
}
const actors = {
	readIntent: fromPromise(async ({ input }: { input: IntentStorage }) => {
		const raw = input.getItem(key)
		return raw === null ? undefined : intentSchema.parse(JSON.parse(raw))
	}),
	saveIntent: fromPromise(
		async ({ input }: { input: { storage: IntentStorage; intent: Intent } }) => {
			input.storage.setItem(key, JSON.stringify(input.intent))
		}
	),
	authorize: fromPromise(
		async ({
			input,
			signal
		}: {
			input: { handle: string; origin: string }
			signal: AbortSignal
		}) => {
			const body = await requestJSON('/api/auth/sign-in/atproto', {
				method: 'POST',
				signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ handle: input.handle, callbackURL: input.origin + '/' })
			})
			return z.object({ url: z.url().refine((value) => value.startsWith('https://')) }).parse(body)
				.url
		}
	),
	session: fromPromise<string>(
		async ({ signal }) =>
			sessionSchema.parse(await requestJSON('/api/auth/get-session', { method: 'GET', signal }))
				.user.id
	),
	navigate: fromPromise(
		async ({ input }: { input: { navigate: Input['navigate']; url: string } }) => {
			input.navigate(input.url)
		}
	)
}

export const atprotoMachine = setup<
	Context,
	Event,
	typeof actors,
	{},
	{ clearIntent: undefined },
	{},
	never,
	string,
	Input
>({
	actors,
	actions: {
		clearIntent: ({ context }) => {
			try {
				context.storage.removeItem(key)
			} catch {
				/* No credential is retained. */
			}
		}
	}
}).createMachine({
	id: 'clipper-atproto',
	initial: 'idle',
	context: ({ input }) => ({
		...input,
		intent: undefined,
		accountId: '',
		handle: '',
		url: '',
		userId: ''
	}),
	on: { SHUTDOWN: '.closed' },
	states: {
		idle: {
			on: {
				RESUME: {
					target: 'reading',
					actions: assign(({ event }) => ({ accountId: event.accountId }))
				},
				BEGIN: {
					target: 'saving',
					actions: assign(({ event }) => ({
						intent: event.intent,
						accountId: event.intent.accountId,
						handle: event.handle
					}))
				}
			}
		},
		reading: {
			invoke: {
				src: 'readIntent',
				input: ({ context }) => context.storage,
				onDone: [
					{ guard: ({ event }) => !event.output, target: 'idle' },
					{
						guard: ({ context, event }) => event.output?.accountId === context.accountId,
						target: 'session',
						actions: assign(({ event }) => ({ intent: event.output }))
					},
					{ target: 'failed' }
				],
				onError: { target: 'idle', actions: 'clearIntent' }
			}
		},
		saving: {
			meta: working,
			invoke: {
				src: 'saveIntent',
				input: ({ context }) => ({
					storage: context.storage,
					intent: intentSchema.parse(context.intent)
				}),
				onDone: 'authorizing',
				onError: 'failed'
			}
		},
		authorizing: {
			meta: working,
			invoke: {
				src: 'authorize',
				input: ({ context }) => ({ handle: context.handle, origin: context.origin }),
				onDone: {
					target: 'navigating',
					actions: assign(({ event }) => ({ url: event.output, handle: '' }))
				},
				onError: 'failed'
			}
		},
		navigating: {
			meta: working,
			invoke: {
				src: 'navigate',
				input: ({ context }) => ({ navigate: context.navigate, url: context.url }),
				onDone: 'redirecting',
				onError: 'failed'
			}
		},
		redirecting: { meta: working },
		session: {
			meta: working,
			invoke: {
				src: 'session',
				onDone: {
					target: 'selectOperation',
					actions: assign(({ event }) => ({ userId: event.output }))
				},
				onError: 'failed'
			}
		},
		selectOperation: {
			always: [
				{
					guard: ({ context }) => context.intent?.operation === 'connect',
					target: 'dispatchConnect'
				},
				{ target: 'dispatchSignIn' }
			]
		},
		dispatchConnect: {
			meta: working,
			entry: ({ context, self }) => {
				context.dispatch({
					type: 'CONNECT_TOKEN',
					accountId: intentSchema.parse(context.intent).accountId,
					source: tokenSource(context.userId, context.origin),
					reportTo: self
				})
			},
			always: 'settling'
		},
		dispatchSignIn: {
			meta: working,
			entry: ({ context, self }) => {
				context.dispatch({
					type: 'SIGN_IN_TOKEN',
					accountId: intentSchema.parse(context.intent).accountId,
					source: tokenSource(context.userId, context.origin),
					reportTo: self
				})
			},
			always: 'settling'
		},
		settling: {
			meta: working,
			on: { SHUTDOWN: 'draining', TOKEN_SUCCEEDED: 'succeeded', TOKEN_FAILED: 'failed' }
		},
		draining: {
			meta: working,
			on: { SHUTDOWN: {}, TOKEN_SUCCEEDED: 'settledClosed', TOKEN_FAILED: 'settledClosed' }
		},
		succeeded: { entry: 'clearIntent' },
		failed: {
			meta: failed,
			entry: 'clearIntent',
			on: {
				BEGIN: {
					target: 'saving',
					actions: assign(({ event }) => ({
						intent: event.intent,
						accountId: event.intent.accountId,
						handle: event.handle
					}))
				}
			}
		},
		settledClosed: { type: 'final', entry: 'clearIntent' },
		closed: { type: 'final' }
	}
})
