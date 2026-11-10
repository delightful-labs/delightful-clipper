import { createAsyncLogic, createCallbackLogic, setup, types, type ActorRefFrom } from 'xstate'
import {
	completionCookie,
	readCompletion,
	clearCompletionCookie,
	completedAttempt
} from './completion.js'

export type Auth = {
	handler: (request: Request) => Promise<Response>
	api: { getSession: (input: { headers: Headers }) => Promise<{ user: { id: string } } | null> }
}
export type AuthRequestInput = {
	auth: Auth
	request: Request
	config: { origin: string; secret: string }
	disconnected?: boolean
}
type Receipt = NonNullable<ReturnType<typeof readCompletion>>
type Result = { kind: 'response'; response: Response } | { kind: 'disconnected' }
type Context = { input: AuthRequestInput; result: Result | undefined }
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Authentication resource unavailable')
	return value
}
function failure(error: string, status: number, fields?: string[]) {
	return Response.json(
		{ error, ...(fields ? { fields } : {}) },
		{ status, headers: { 'Cache-Control': 'no-store' } }
	)
}
function discard(response: Response | undefined) {
	try {
		void response?.body?.cancel().catch(() => {})
	} catch {
		/* Native stream may already be closed. */
	}
}
function issuedHeaders(response: Response) {
	return new Headers({
		cookie: response.headers
			.getSetCookie()
			.map((cookie) => cookie.split(';')[0])
			.join('; ')
	})
}
/** One provider operation and native response lease; the chart selects transfer. */
const provider = createCallbackLogic<{ type: 'TRANSFER' }, AuthRequestInput>(
	({ input, receive, sendBack }) => {
		const controller = new AbortController()
		let response: Response | undefined,
			disposed = false,
			transferred = false
		receive(() => {
			transferred = true
			sendBack({ type: 'RESPONSE_TRANSFERRED' })
		})
		void Promise.resolve()
			.then(() => {
				controller.signal.throwIfAborted()
				return input.auth.handler(new Request(input.request, { signal: controller.signal }))
			})
			.then(
				(value) => {
					response = value
					if (disposed) discard(value)
					else sendBack({ type: 'PROVIDER_RETURNED', response: value })
				},
				() => sendBack({ type: 'PROVIDER_FAILED' })
			)
		return () => {
			disposed = true
			if (!transferred) {
				controller.abort()
				discard(response)
			}
		}
	}
)
const receipt = createAsyncLogic({
	run: async ({ input }: { input: AuthRequestInput }) =>
		readCompletion(input.request, input.config.secret)
})
function sessionRead<Facts>() {
	return createAsyncLogic({
		run: async ({
			input,
			signal
		}: {
			input: { auth: Auth; headers: Headers; facts: Facts }
			signal: AbortSignal
		}) => {
			signal.throwIfAborted()
			// Better Auth's server API has no abort contract; suppress late results.
			const session = await input.auth.api.getSession({ headers: input.headers })
			signal.throwIfAborted()
			return { session, facts: input.facts, observedAt: Date.now() }
		}
	})
}
const incomingSession = sessionRead<Receipt>()
const issuedSession = sessionRead<{ response: Response; attemptId: string }>()
type CallbackReceipt = { response: Response; attemptId: string; userId: string }
const appendReceipt = createAsyncLogic({
	run: async ({
		input
	}: {
		input: CallbackReceipt & { config: AuthRequestInput['config']; secure: boolean }
	}) => {
		const headers = new Headers(input.response.headers)
		headers.append(
			'Set-Cookie',
			completionCookie(input.attemptId, input.userId, input.config.secret, input.secure)
		)
		return new Response(input.response.body, {
			status: input.response.status,
			statusText: input.response.statusText,
			headers
		})
	}
})
export const authRequestMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<AuthRequestInput>(),
		output: types<Result>(),
		events: {
			DISCONNECT: types(),
			PROVIDER_FAILED: types(),
			RESPONSE_TRANSFERRED: types(),
			PROVIDER_RETURNED: types<{ response: Response }>()
		},
		children: {
			provider: types<ActorRefFrom<typeof provider>>(),
			receipt: types<ActorRefFrom<typeof receipt>>(),
			incomingSession: types<ActorRefFrom<typeof incomingSession>>(),
			issuedSession: types<ActorRefFrom<typeof issuedSession>>(),
			appendReceipt: types<ActorRefFrom<typeof appendReceipt>>()
		}
	},
	states: {
		admitting: {},
		validatingReceipt: {},
		readingIncomingSession: { schemas: { input: types<{ receipt: Receipt }>() } },
		delegating: {
			states: {
				waiting: {},
				readingIssuedSession: {
					schemas: { input: types<{ response: Response; attemptId: string }>() }
				},
				issuingReceipt: { schemas: { input: types<CallbackReceipt>() } },
				transferring: {}
			}
		},
		responded: { id: 'auth-request-responded', type: 'final' },
		refused: { type: 'final' },
		conflict: { id: 'auth-request-conflict', type: 'final' },
		failed: { id: 'auth-request-failed', type: 'final' },
		disconnected: { type: 'final' }
	},
	actors: { provider, receipt, incomingSession, issuedSession, appendReceipt },
	guards: {
		alreadyDisconnected: ({ context }: { context: Context }) => context.input.disconnected === true,
		completionEndpoint: ({ context }: { context: Context }) =>
			new URL(context.input.request.url).pathname === '/api/auth/atproto/completion',
		validCompletionRequest: ({ context }: { context: Context }) =>
			context.input.request.method === 'POST' &&
			context.input.request.headers.get('origin') === context.input.config.origin,
		callbackEndpoint: ({ context }: { context: Context }) =>
			new URL(context.input.request.url).pathname === '/api/auth/atproto/callback',
		matchingUser: (
			_args: object,
			receipt: Receipt,
			session: { user: { id: string } } | null,
			observedAt: number
		) => receipt.userId === session?.user.id && receipt.expires > observedAt
	}
}).createMachine({
	id: 'auth-request',
	context: ({ input }) => ({ input, result: undefined }),
	initial: 'admitting',
	output: ({ context }) => required(context.result),
	on: { DISCONNECT: { target: '.disconnected' } },
	states: {
		admitting: {
			type: 'choice',
			choice: (args) =>
				args.guards.alreadyDisconnected(args)
					? { target: 'disconnected' }
					: args.guards.completionEndpoint(args)
						? args.guards.validCompletionRequest(args)
							? { target: 'validatingReceipt' }
							: { target: 'refused' }
						: { target: 'delegating' }
		},
		validatingReceipt: {
			invoke: {
				id: 'receipt',
				src: 'receipt',
				input: ({ context }) => context.input,
				onDone: ({ event }) =>
					event.output
						? { target: 'readingIncomingSession', input: { receipt: event.output } }
						: { target: 'conflict' },
				onError: { target: 'failed' }
			}
		},
		readingIncomingSession: {
			invoke: {
				id: 'incomingSession',
				src: 'incomingSession',
				input: ({ context, input }) => ({
					auth: context.input.auth,
					headers: context.input.request.headers,
					facts: input.receipt
				}),
				onDone: (args) =>
					args.guards.matchingUser(
						args,
						args.event.output.facts,
						args.event.output.session,
						args.event.output.observedAt
					)
						? {
								target: 'responded',
								context: {
									result: {
										kind: 'response',
										response: Response.json(
											{
												attemptId: args.event.output.facts.attemptId,
												userId: args.event.output.facts.userId
											},
											{
												headers: {
													'Cache-Control': 'no-store',
													'Set-Cookie': clearCompletionCookie
												}
											}
										)
									}
								}
							}
						: { target: 'conflict' },
				onError: { target: 'failed' }
			}
		},
		delegating: {
			initial: 'waiting',
			invoke: {
				id: 'provider',
				src: 'provider',
				input: ({ context }) => context.input,
				onError: { target: 'failed' }
			},
			on: { PROVIDER_FAILED: { target: 'failed' } },
			states: {
				waiting: {
					on: {
						PROVIDER_RETURNED: (args) => {
							const attemptId = args.guards.callbackEndpoint(args)
								? completedAttempt(args.event.response, args.context.input.config.origin)
								: undefined
							return attemptId
								? {
										target: 'readingIssuedSession',
										input: { response: args.event.response, attemptId }
									}
								: {
										target: 'transferring',
										context: { result: { kind: 'response', response: args.event.response } }
									}
						}
					}
				},
				readingIssuedSession: {
					invoke: {
						id: 'issuedSession',
						src: 'issuedSession',
						input: ({ context, input }) => ({
							auth: context.input.auth,
							headers: issuedHeaders(input.response),
							facts: input
						}),
						onDone: ({ event }) =>
							event.output.session
								? {
										target: 'issuingReceipt',
										input: { ...event.output.facts, userId: event.output.session.user.id }
									}
								: { target: '#auth-request-conflict' },
						onError: { target: '#auth-request-failed' }
					}
				},
				issuingReceipt: {
					invoke: {
						id: 'appendReceipt',
						src: 'appendReceipt',
						input: ({ context, input }) => ({
							...input,
							config: context.input.config,
							secure: new URL(context.input.request.url).protocol === 'https:'
						}),
						onDone: ({ event }) => ({
							target: 'transferring',
							context: { result: { kind: 'response', response: event.output } }
						}),
						onError: { target: '#auth-request-failed' }
					}
				},
				transferring: {
					entry: (_args, enq) => enq.sendTo('provider', { type: 'TRANSFER' }),
					on: { RESPONSE_TRANSFERRED: { target: '#auth-request-responded' } }
				}
			}
		},
		responded: { id: 'auth-request-responded', type: 'final' },
		refused: {
			type: 'final',
			entry: () => ({
				context: {
					result: { kind: 'response', response: failure('invalid_completion_request', 403) }
				}
			})
		},
		conflict: {
			type: 'final',
			entry: () => ({
				context: {
					result: { kind: 'response', response: failure('oauth_completion_unavailable', 409) }
				}
			})
		},
		failed: {
			type: 'final',
			entry: () => ({
				context: { result: { kind: 'response', response: failure('auth_request_failed', 500, []) } }
			})
		},
		disconnected: {
			type: 'final',
			entry: () => ({ context: { result: { kind: 'disconnected' } } })
		}
	}
})
