import type { EventPayload } from '../events.js'
import { types, setup, matchesState, type AnyActorRef, type AnyStateMachine } from 'xstate'

import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type {
	WorkspaceCreationAssessment,
	DetachedTransaction,
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from 'delightful-local-first/workspace/creation/contracts'
import type { SyncReceipt } from '../../contracts/storage.js'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import type { WriteHandle } from 'jazz-tools'

type Reply<T> = { resolve: (value: T) => void; reject: (error: unknown) => void }
type ReadRequest<Resource> = {
	type: 'READ'
	resource: Resource
	reply: Reply<WorkspaceCreationAssessment>
}
type StageRequest = { type: 'STAGE'; reply: Reply<SyncReceipt> }
type Prepared = { type: 'PREPARED'; assessment: WorkspaceCreationAssessment }
type Event<Resource> =
	| ReadRequest<Resource>
	| StageRequest
	| Prepared
	| { type: 'CANCEL' | 'SHUTDOWN' }
export type TransactionDomainInput<Draft> = {
	resource: TransactionResource
	attempt: WorkspaceCreationAttempt<Draft>
	owner: AnyActorRef
}
export function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transaction domain resource')
	return value
}
function requestRead<Resource>(owner: AnyActorRef, resource: Resource) {
	return new Promise<WorkspaceCreationAssessment>((resolve, reject) =>
		owner.send({
			type: 'READ',
			resource,
			reply: { resolve, reject }
		} satisfies ReadRequest<Resource>)
	)
}
function requestStage(owner: AnyActorRef) {
	return new Promise<SyncReceipt>((resolve, reject) =>
		owner.send({ type: 'STAGE', reply: { resolve, reject } } satisfies StageRequest)
	)
}

/** DLF alone acquires, commits, drains and rolls back the transaction. The invoked
 * domain chart owns facts, guards and mutations; messages cross the callback API
 * without storing domain state on an imperative transaction handle. */
function createDomainTransactionController<Draft, Resource, Write>(
	domain: AnyStateMachine,
	lifecycle: {
		retainDetached: (custody: DetachedTransaction<Resource, Write>) => void
		open: () => Resource | PromiseLike<Resource>
		commit: (resource: Resource) => Write | PromiseLike<Write>
		persistLocal: (write: Write) => void | PromiseLike<void>
		rollback: (resource: Resource) => boolean | PromiseLike<boolean>
	}
) {
	type Attempt = WorkspaceCreationAttempt<Draft>
	type Context = {
		record: {
			attempt: Attempt
			resource: Resource | undefined
			readReply: Reply<WorkspaceCreationAssessment> | undefined
			stageReply: Reply<SyncReceipt> | undefined
			result: WorkspaceCreationResult<Draft, SyncReceipt> | undefined
		}
	}
	const transaction = createWorkspaceCreationTransaction<
		{ request: Draft; domain: AnyActorRef },
		Resource,
		WorkspaceCreationAssessment,
		SyncReceipt,
		Write
	>({
		...lifecycle,
		readLocal: (resource, attempt) => requestRead(attempt.draft.domain, resource),
		assess: (assessment) => assessment,
		stage: (_resource, attempt) => requestStage(attempt.draft.domain)
	})
	const actors = { transaction, domain }
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				STAGE: types<EventPayload<Event<Resource>, 'STAGE'>>(),
				PREPARED: types<EventPayload<Event<Resource>, 'PREPARED'>>(),
				SHUTDOWN: types<EventPayload<Event<Resource>, 'SHUTDOWN'>>(),
				CANCEL: types<EventPayload<Event<Resource>, 'CANCEL'>>(),
				READ: types<EventPayload<Event<Resource>, 'READ'>>()
			},
			input: types<{ attempt: Attempt }>(),
			output: types<WorkspaceCreationResult<Draft, SyncReceipt>>(),
			tags: types<string>(),
			children: {
				transaction: types<import('xstate').ActorRefFrom<typeof transaction>>(),
				domain: types<import('xstate').ActorRefFrom<typeof domain>>()
			}
		},
		actors,
		guards: {
			reading: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ running: { domain: { processing: 'reading' } } }, value)
		},
		actions: {
			acceptRead: (args: { context: Context }, params: ReadRequest<Resource>) => ({
				context: {
					record: {
						...args.context.record,
						resource: ((_, request: ReadRequest<Resource>) => request.resource)(args, params),
						readReply: ((_, request: ReadRequest<Resource>) => request.reply)(args, params)
					}
				}
			}),
			acceptStage: (args: { context: Context }, params: StageRequest) => ({
				context: {
					record: {
						...args.context.record,
						stageReply: ((_, request: StageRequest) => request.reply)(args, params)
					}
				}
			}),
			reportPrepared: ({ context }: { context: Context }, event: Prepared) =>
				required(context.record.readReply).resolve(event.assessment),
			reportStaged: ({ context }: { context: Context }, event: { receipt: SyncReceipt }) =>
				required(context.record.stageReply).resolve(event.receipt),
			rejectRead: ({ context }: { context: Context }, event: { error: unknown }) =>
				required(context.record.readReply).reject(event.error),
			rejectStage: ({ context }: { context: Context }, event: { error: unknown }) =>
				required(context.record.stageReply).reject(event.error),
			finish: (
				args: { context: Context },
				params: {
					result: WorkspaceCreationResult<{ request: Draft; domain: AnyActorRef }, SyncReceipt>
				}
			) => ({
				context: {
					record: {
						...args.context.record,
						result: ((
							{ context },
							event: {
								result: WorkspaceCreationResult<
									{
										request: Draft
										domain: AnyActorRef
									},
									SyncReceipt
								>
							}
						) => ({
							...event.result,
							attempt: context.record.attempt
						}))(args, params)
					}
				}
			})
		}
	}).createMachine({
		id: 'domain-transaction',
		context: ({ input }) => ({
			record: {
				attempt: input.attempt,
				resource: undefined,
				readReply: undefined,
				stageReply: undefined,
				result: undefined
			}
		}),
		initial: 'running',
		output: ({ context }) => required(context.record.result),
		states: {
			running: {
				type: 'parallel',
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('transaction', { type: 'CANCEL' })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('transaction', { type: 'SHUTDOWN' })
					}
				},
				states: {
					transaction: {
						invoke: {
							id: 'transaction',
							src: 'transaction',
							input: ({ context, self }) => ({
								attempt: {
									...context.record.attempt,
									draft: { request: context.record.attempt.draft, domain: self }
								}
							}),
							onDone: (args) => {
								return {
									target: '#domain-transaction.completed',
									context: args.actions.finish(args, { result: args.event.output }).context
								}
							}
						}
					},
					domain: {
						initial: 'waiting',
						states: {
							waiting: {
								on: {
									READ: (args) => {
										const { event } = args
										return {
											target: 'processing',
											context: args.actions.acceptRead(args, event).context
										}
									}
								}
							},
							processing: {
								invoke: {
									id: 'domain',
									src: 'domain',
									input: ({ context, self }: { context: Context; self: AnyActorRef }) =>
										({
											resource: required(context.record.resource),
											attempt: context.record.attempt,
											owner: self
										}) satisfies { resource: Resource; attempt: Attempt; owner: AnyActorRef },
									onDone: (args, enq) => {
										enq(args.actions.reportStaged, args, { receipt: args.event.output })
										return { target: 'staged' }
									},
									onError: (args, enq) => {
										const { event } = args
										if (
											matchesState({ running: { domain: { processing: 'reading' } } }, args.value)
										) {
											enq(args.actions.rejectRead, args, { error: event.error })
											return { target: 'failed' }
										}
										enq(args.actions.rejectStage, args, { error: event.error })
										return { target: 'failed' }
									}
								},
								initial: 'reading',
								states: {
									reading: {
										on: {
											PREPARED: (args, enq) => {
												const { event } = args
												enq(args.actions.reportPrepared, args, event)
												return { target: 'awaitingStage' }
											}
										}
									},
									awaitingStage: {
										on: {
											STAGE: (args, enq) => {
												const { event } = args
												enq.sendTo('domain', { type: 'STAGE' })
												return {
													target: 'staging',
													context: args.actions.acceptStage(args, event).context
												}
											}
										}
									},
									staging: {}
								}
							},
							staged: {},
							failed: {}
						}
					}
				}
			},
			completed: { type: 'final' }
		}
	})
}

/** Expose only lifecycle commands to application actors. Read/stage protocol
 * events remain private to the invoked controller and its domain child. */
export function createDomainTransaction<Draft, Resource = TransactionResource, Write = WriteHandle>(
	domain: AnyStateMachine,
	lifecycle: {
		retainDetached: (custody: DetachedTransaction<Resource, Write>) => void
		open: () => Resource | PromiseLike<Resource>
		commit: (resource: Resource) => Write | PromiseLike<Write>
		persistLocal: (write: Write) => void | PromiseLike<void>
		rollback: (resource: Resource) => boolean | PromiseLike<boolean>
	}
) {
	type Input = { attempt: WorkspaceCreationAttempt<Draft> }
	type Result = WorkspaceCreationResult<Draft, SyncReceipt>
	type Context = { record: Input & { result: Result | undefined } }
	const actors = {
		workflow: createDomainTransactionController<Draft, Resource, Write>(domain, lifecycle)
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				SHUTDOWN: types<EventPayload<{ type: 'CANCEL' | 'SHUTDOWN' }, 'SHUTDOWN'>>(),
				CANCEL: types<EventPayload<{ type: 'CANCEL' | 'SHUTDOWN' }, 'CANCEL'>>()
			},
			input: types<Input>(),
			output: types<Result>(),
			tags: types<string>(),
			children: { workflow: types<import('xstate').ActorRefFrom<typeof actors.workflow>>() }
		},
		actors,
		actions: {
			finish: (args: { context: Context }, params: { result: Result }) => ({
				context: {
					record: {
						...args.context.record,
						result: ((
							_,
							params: {
								result: Result
							}
						) => params.result)(args, params)
					}
				}
			})
		}
	}).createMachine({
		context: ({ input }) => ({ record: { ...input, result: undefined } }),
		initial: 'running',
		output: ({ context }) => required(context.record.result),
		states: {
			running: {
				invoke: {
					id: 'workflow',
					src: 'workflow',
					input: ({ context }: { context: Context }) => ({ attempt: context.record.attempt }),
					onDone: (args) => {
						return {
							target: 'done',
							context: args.actions.finish(args, { result: args.event.output }).context
						}
					}
				},
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('workflow', { type: 'CANCEL' })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('workflow', { type: 'SHUTDOWN' })
					}
				}
			},
			done: { type: 'final' }
		}
	})
}
