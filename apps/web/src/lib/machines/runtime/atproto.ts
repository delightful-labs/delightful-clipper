import { createAsyncLogic, setup, types, type ActorRefFrom, type SnapshotFrom } from 'xstate'
import { identityLogic } from '../identity.js'
import { z } from 'zod'
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
const completionSchema = z.object({ attemptId: z.uuid(), userId: z.string().min(1) })
const redirectSchema = z.object({
	url: z.url().refine((value) => new URL(value).protocol === 'https:')
})
type Input = { callbackAttempt?: string | null | undefined }
type Context = Input
type Event = { type: 'BEGIN'; handle: string }
const actors = {
	identity: identityLogic,
	authorize: createAsyncLogic({
		run: async ({
			input,
			signal
		}: {
			input: { handle: string; attemptId: string }
			signal: AbortSignal
		}) => {
			const value = await requestJSON('/api/auth/sign-in/atproto', {
				method: 'POST',
				signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					handle: input.handle,
					callbackURL: '/?atproto_attempt=' + input.attemptId
				})
			})
			return redirectSchema.parse(value).url
		}
	}),
	complete: createAsyncLogic({
		run: async ({ input, signal }: { input: string; signal: AbortSignal }) => {
			const attempt = z.uuid().parse(input)
			const completion = completionSchema.parse(
				await requestJSON('/api/auth/atproto/completion', { method: 'POST', signal })
			)
			if (completion.attemptId !== attempt) throw new Error('OAuth attempt did not complete')
		}
	})
}
/** Only the provider redirect belongs to Clipper. Jazz follows the verified backend
 * cookie itself; there are no JWT sources, saved selections or manual links here. */
export const atprotoMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<Input>(),
		events: { BEGIN: types<{ handle: string }>() },
		tags: types<string>(),
		children: {
			identity: types<ActorRefFrom<typeof actors.identity>>(),
			authorize: types<ActorRefFrom<typeof actors.authorize>>(),
			complete: types<ActorRefFrom<typeof actors.complete>>()
		}
	},
	states: {
		starting: {},
		idle: {},
		failed: {},
		issuingAttempt: {
			schemas: { context: types<{ handle: string }>() }
		},
		authorizing: { schemas: { input: types<{ handle: string; attemptId: string }>() } },
		redirecting: { schemas: { input: types<{ url: string }>() } },
		completing: { schemas: { input: types<{ attemptId: string }>() } }
	},
	actors,
	guards: {
		returning: ({ context }) => context.callbackAttempt != null,
		validHandle: ({ event }: { event: Event }) => event.handle.trim().length > 0
	}
}).createMachine({
	id: 'atproto',
	context: ({ input }) => input,
	initial: 'starting',
	states: {
		starting: {
			type: 'choice',
			choice: (args) =>
				args.guards.returning(args)
					? { target: 'completing', input: { attemptId: args.context.callbackAttempt! } }
					: { target: 'idle' }
		},
		idle: {
			on: {
				BEGIN: (args) => {
					if (!args.guards.validHandle(args)) return
					return { target: 'issuingAttempt', context: { handle: args.event.handle.trim() } }
				}
			}
		},
		issuingAttempt: {
			tags: ['busy'],
			invoke: {
				id: 'identity',
				src: 'identity',
				onDone: ({ event, context }) => ({
					target: 'authorizing',
					input: { handle: context.handle, attemptId: event.output }
				}),
				onError: { target: 'failed' }
			}
		},
		authorizing: {
			tags: ['busy'],
			invoke: {
				id: 'authorize',
				src: 'authorize',
				input: ({ input }) => input,
				onDone: ({ event }) => ({ target: 'redirecting', input: { url: event.output } }),
				onError: { target: 'failed' }
			}
		},
		redirecting: {
			tags: ['busy'],
			entry: ({ input, parent }, enq) => {
				enq.sendTo(parent, { type: 'OAUTH_REDIRECT', url: input.url })
			}
		},
		completing: {
			tags: ['busy'],
			invoke: {
				id: 'complete',
				src: 'complete',
				input: ({ input }) => input.attemptId,
				onDone: ({ parent }, enq) => {
					enq.sendTo(parent, { type: 'OAUTH_RETURNED' })
					return { target: 'idle' }
				},
				onError: { target: 'failed' }
			}
		},
		failed: {
			on: {
				BEGIN: (args) => {
					if (!args.guards.validHandle(args)) return
					return { target: 'issuingAttempt', context: { handle: args.event.handle.trim() } }
				}
			}
		}
	}
})
export function selectAtprotoView(snapshot: SnapshotFrom<typeof atprotoMachine> | undefined) {
	return {
		busy: snapshot?.hasTag('busy') === true,
		message: snapshot?.matches('failed')
			? { text: t('account.feedback.identityFailed'), variant: 'error' as const }
			: snapshot?.hasTag('busy')
				? { text: t('account.status.working'), variant: 'info' as const }
				: undefined
	}
}
