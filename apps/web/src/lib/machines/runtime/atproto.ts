import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate'
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
type Context = Input & { attemptId: string; handle: string; url: string }
type Event = { type: 'BEGIN'; handle: string }
const actors = {
	authorize: fromPromise(
		async ({
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
	),
	complete: fromPromise(async ({ input, signal }: { input: string; signal: AbortSignal }) => {
		const attempt = z.uuid().parse(input)
		const completion = completionSchema.parse(
			await requestJSON('/api/auth/atproto/completion', { method: 'POST', signal })
		)
		if (completion.attemptId !== attempt) throw new Error('OAuth attempt did not complete')
	})
}
/** Only the provider redirect belongs to Clipper. Jazz follows the verified backend
 * cookie itself; there are no JWT sources, saved selections or manual links here. */
export const atprotoMachine = setup<
	Context,
	Event,
	typeof actors,
	{},
	{},
	{
		returning: undefined
		validHandle: undefined
	},
	never,
	string,
	Input
>({
	actors,
	guards: {
		returning: ({ context }) => context.callbackAttempt != null,
		validHandle: ({ event }) => event.handle.trim().length > 0
	}
}).createMachine({
	id: 'atproto',
	context: ({ input }) => ({
		...input,
		attemptId: input.callbackAttempt ?? '',
		handle: '',
		url: ''
	}),
	initial: 'starting',
	states: {
		starting: { always: [{ guard: 'returning', target: 'completing' }, { target: 'idle' }] },
		idle: {
			on: {
				BEGIN: {
					guard: 'validHandle',
					target: 'authorizing',
					actions: assign({
						handle: ({ event }) => event.handle.trim(),
						attemptId: () => crypto.randomUUID()
					})
				}
			}
		},
		authorizing: {
			tags: 'busy',
			invoke: {
				src: 'authorize',
				input: ({ context }) => ({ handle: context.handle, attemptId: context.attemptId }),
				onDone: { target: 'redirecting', actions: assign({ url: ({ event }) => event.output }) },
				onError: 'failed'
			}
		},
		redirecting: {
			tags: 'busy',
			entry: sendParent(({ context }) => ({ type: 'OAUTH_REDIRECT' as const, url: context.url }))
		},
		completing: {
			tags: 'busy',
			invoke: {
				src: 'complete',
				input: ({ context }) => context.attemptId,
				onDone: { target: 'idle', actions: sendParent({ type: 'OAUTH_RETURNED' }) },
				onError: 'failed'
			}
		},
		failed: {
			on: {
				BEGIN: {
					guard: 'validHandle',
					target: 'authorizing',
					actions: assign({
						handle: ({ event }) => event.handle.trim(),
						attemptId: () => crypto.randomUUID()
					})
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
