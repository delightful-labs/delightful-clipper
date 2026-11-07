import { assign, sendTo, setup, stateIn } from 'xstate'
import type { AnyActorRef, AnyStateMachine } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type {
	WorkspaceCreationAssessment,
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from 'delightful-local-first/workspace/creation/contracts'
import type { SyncReceipt } from '../contracts/storage.js'
import type { TransactionResource } from '../backend/jazz/transaction.js'
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
export type NoteDomainInput<Draft> = {
	resource: TransactionResource
	attempt: WorkspaceCreationAttempt<Draft>
	owner: AnyActorRef
}
export function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing note operation resource')
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
export function createNoteOperation<Draft, Resource = TransactionResource, Write = WriteHandle>(
	domain: AnyStateMachine,
	lifecycle: {
		open: () => Resource | PromiseLike<Resource>
		commit: (resource: Resource) => Write | PromiseLike<Write>
		persistLocal: (write: Write) => void | PromiseLike<void>
		rollback: (resource: Resource) => boolean | PromiseLike<boolean>
	}
) {
	type Attempt = WorkspaceCreationAttempt<Draft>
	type Context = {
		attempt: Attempt
		resource: Resource | undefined
		readReply: Reply<WorkspaceCreationAssessment> | undefined
		stageReply: Reply<SyncReceipt> | undefined
		result: WorkspaceCreationResult<Draft, SyncReceipt> | undefined
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
	return setup<
		Context,
		Event<Resource>,
		typeof actors,
		{},
		{
			acceptRead: ReadRequest<Resource>
			acceptStage: StageRequest
			reportPrepared: Prepared
			reportStaged: { receipt: SyncReceipt }
			rejectRead: { error: unknown }
			rejectStage: { error: unknown }
			finish: {
				result: WorkspaceCreationResult<{ request: Draft; domain: AnyActorRef }, SyncReceipt>
			}
			stageDomain: undefined
			cancel: undefined
			shutdown: undefined
		},
		{ reading: undefined },
		never,
		string,
		{ attempt: Attempt },
		WorkspaceCreationResult<Draft, SyncReceipt>
	>({
		actors,
		guards: { reading: stateIn({ running: { domain: { processing: 'reading' } } }) },
		actions: {
			acceptRead: assign({
				resource: (_, request) => request.resource,
				readReply: (_, request) => request.reply
			}),
			acceptStage: assign({ stageReply: (_, request) => request.reply }),
			reportPrepared: ({ context }, event) => required(context.readReply).resolve(event.assessment),
			reportStaged: ({ context }, event) => required(context.stageReply).resolve(event.receipt),
			rejectRead: ({ context }, event) => required(context.readReply).reject(event.error),
			rejectStage: ({ context }, event) => required(context.stageReply).reject(event.error),
			finish: assign({
				result: ({ context }, event) => ({ ...event.result, attempt: context.attempt })
			}),
			stageDomain: sendTo('domain', { type: 'STAGE' }),
			cancel: sendTo('transaction', { type: 'CANCEL' }),
			shutdown: sendTo('transaction', { type: 'SHUTDOWN' })
		}
	}).createMachine({
		id: 'note-operation',
		context: ({ input }) => ({
			attempt: input.attempt,
			resource: undefined,
			readReply: undefined,
			stageReply: undefined,
			result: undefined
		}),
		initial: 'running',
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				on: { CANCEL: { actions: 'cancel' }, SHUTDOWN: { actions: 'shutdown' } },
				states: {
					transaction: {
						invoke: {
							id: 'transaction',
							src: 'transaction',
							input: ({ context, self }) => ({
								attempt: {
									...context.attempt,
									draft: { request: context.attempt.draft, domain: self }
								}
							}),
							onDone: {
								target: '#note-operation.completed',
								actions: { type: 'finish', params: ({ event }) => ({ result: event.output }) }
							}
						}
					},
					domain: {
						initial: 'waiting',
						states: {
							waiting: {
								on: {
									READ: {
										target: 'processing',
										actions: { type: 'acceptRead', params: ({ event }) => event }
									}
								}
							},
							processing: {
								invoke: {
									id: 'domain',
									src: 'domain',
									input: ({ context, self }: { context: Context; self: AnyActorRef }) =>
										({
											resource: required(context.resource),
											attempt: context.attempt,
											owner: self
										}) satisfies { resource: Resource; attempt: Attempt; owner: AnyActorRef },
									onDone: {
										target: 'staged',
										actions: {
											type: 'reportStaged',
											params: ({ event }) => ({ receipt: event.output })
										}
									},
									onError: [
										{
											guard: 'reading',
											target: 'failed',
											actions: {
												type: 'rejectRead',
												params: ({ event }) => ({ error: event.error })
											}
										},
										{
											target: 'failed',
											actions: {
												type: 'rejectStage',
												params: ({ event }) => ({ error: event.error })
											}
										}
									]
								},
								initial: 'reading',
								states: {
									reading: {
										on: {
											PREPARED: {
												target: 'awaitingStage',
												actions: { type: 'reportPrepared', params: ({ event }) => event }
											}
										}
									},
									awaitingStage: {
										on: {
											STAGE: {
												target: 'staging',
												actions: [
													{ type: 'acceptStage', params: ({ event }) => event },
													'stageDomain'
												]
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
