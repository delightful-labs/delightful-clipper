import { createAsyncLogic, setup, types, type ActorRefFrom, type SnapshotFrom } from 'xstate'
import { identityLogic } from '../identity.js'
import { z } from 'zod'
import { t } from '../../localization/index.js'
import { stateFeedback, type NamedState } from '../../contracts/feedback.js'

export const AUTH_REQUEST_TIMEOUT_MS = 30_000

const monotonicNow = () => performance.now()
async function requestJSON(path: string, init: RequestInit, now: () => number) {
	const startedAt = now()
	const response = await fetch(path, {
		...init,
		credentials: 'same-origin',
		cache: 'no-store',
		redirect: 'error'
	})
	if (!response.ok) {
		void response.body?.cancel().catch(() => {})
		throw new Error('Authentication request failed')
	}
	const value: unknown = await response.json()
	init.signal?.throwIfAborted()
	return { value, elapsedMs: now() - startedAt }
}
const completionSchema = z.object({ attemptId: z.uuid(), userId: z.string().min(1) })
const redirectSchema = z.object({
	url: z.url().refine((value) => new URL(value).protocol === 'https:')
})
type Input = {
	callbackAttempt?: string | null | undefined
	requestTimeoutMs?: number
	now?: () => number
}
type Context = Input
type Event = { type: 'BEGIN'; handle: string }
const actors = {
	identity: identityLogic,
	authorize: createAsyncLogic({
		run: async ({
			input,
			signal
		}: {
			input: { handle: string; attemptId: string; now: () => number }
			signal: AbortSignal
		}) => {
			const result = await requestJSON(
				'/api/auth/sign-in/atproto',
				{
					method: 'POST',
					signal,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						handle: input.handle,
						callbackURL: '/?atproto_attempt=' + input.attemptId
					})
				},
				input.now
			)
			return { url: redirectSchema.parse(result.value).url, elapsedMs: result.elapsedMs }
		}
	}),
	complete: createAsyncLogic({
		run: async ({
			input,
			signal
		}: {
			input: { attemptId: string; now: () => number }
			signal: AbortSignal
		}) => {
			const attempt = z.uuid().parse(input.attemptId)
			const result = await requestJSON(
				'/api/auth/atproto/completion',
				{ method: 'POST', signal },
				input.now
			)
			const completion = completionSchema.parse(result.value)
			if (completion.attemptId !== attempt) throw new Error('OAuth attempt did not complete')
			return { elapsedMs: result.elapsedMs }
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
		meta: types<NamedState & { confirmation?: 'uncertain' }>(),
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
		completionUncertain: {},
		issuingAttempt: {
			schemas: { context: types<{ handle: string }>() }
		},
		authorizing: { schemas: { input: types<{ handle: string; attemptId: string }>() } },
		redirecting: { schemas: { input: types<{ url: string }>() } },
		completing: { schemas: { input: types<{ attemptId: string }>() } }
	},
	actors,
	delays: { requestDeadline: ({ context }) => context.requestTimeoutMs ?? AUTH_REQUEST_TIMEOUT_MS },
	guards: {
		withinDeadline: ({ context }: { context: Context }, result: { elapsedMs: number }) =>
			result.elapsedMs >= 0 &&
			result.elapsedMs < (context.requestTimeoutMs ?? AUTH_REQUEST_TIMEOUT_MS),
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
			meta: { name: t('account.status.working'), variant: 'info' },
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
			meta: { name: t('account.status.working'), variant: 'info' },
			timeout: 'requestDeadline',
			onTimeout: { target: 'failed' },
			invoke: {
				id: 'authorize',
				src: 'authorize',
				input: ({ context, input }) => ({ ...input, now: context.now ?? monotonicNow }),
				onDone: (args) =>
					args.guards.withinDeadline(args, args.event.output)
						? { target: 'redirecting', input: { url: args.event.output.url } }
						: { target: 'failed' },
				onError: { target: 'failed' }
			}
		},
		redirecting: {
			tags: ['busy'],
			meta: { name: t('account.status.working'), variant: 'info' },
			entry: ({ input, parent }, enq) => {
				enq.sendTo(parent, { type: 'OAUTH_REDIRECT', url: input.url })
			}
		},
		completing: {
			tags: ['busy'],
			meta: { name: t('account.status.working'), variant: 'info' },
			timeout: 'requestDeadline',
			onTimeout: { target: 'completionUncertain' },
			invoke: {
				id: 'complete',
				src: 'complete',
				input: ({ context, input }) => ({
					attemptId: input.attemptId,
					now: context.now ?? monotonicNow
				}),
				onDone: (args, enq) => {
					if (!args.guards.withinDeadline(args, args.event.output))
						return { target: 'completionUncertain' }
					const { parent } = args
					enq.sendTo(parent, { type: 'OAUTH_RETURNED' })
					return { target: 'idle' }
				},
				onError: { target: 'completionUncertain' }
			}
		},
		completionUncertain: {
			meta: {
				name: t('account.feedback.identityFailed'),
				variant: 'error',
				confirmation: 'uncertain'
			},
			on: {
				BEGIN: (args) => {
					if (!args.guards.validHandle(args)) return
					return { target: 'issuingAttempt', context: { handle: args.event.handle.trim() } }
				}
			}
		},
		failed: {
			meta: { name: t('account.feedback.identityFailed'), variant: 'error' },
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
	const metadata = snapshot ? Object.values(snapshot.getMeta()) : []
	return {
		busy: snapshot?.hasTag('busy') === true,
		...(metadata.some((meta) => meta?.confirmation === 'uncertain')
			? { confirmation: 'uncertain' as const }
			: {}),
		message: stateFeedback(metadata)
	}
}
