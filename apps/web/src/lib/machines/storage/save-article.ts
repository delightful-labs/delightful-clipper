import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic, matchesState } from 'xstate'

import type {
	Article,
	ArticleDraft,
	ArticleSaveCapability,
	ArticleSaveResult,
	ArticleStageResult,
	SaveArticleRequest
} from '../../contracts/articles.js'
import type { SaveResult } from '../../contracts/storage.js'
function required<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('Missing article resource')
	return v
}
type Context = {
	request: SaveArticleRequest | undefined
	draft: ArticleDraft | undefined
	existing: Article | null
	result: ArticleSaveResult | undefined
	ownedEnsure:
		| import('xstate').ActorInstance<
				import('xstate').Snapshot<ArticleStageResult>,
				{ type: 'SHUTDOWN' | 'CANCEL' }
		  >
		| undefined
	ownedAttach:
		| import('xstate').ActorInstance<
				import('xstate').Snapshot<ArticleStageResult>,
				{ type: 'SHUTDOWN' | 'CANCEL' }
		  >
		| undefined
	ownedContent:
		| import('xstate').ActorInstance<import('xstate').Snapshot<SaveResult>, { type: 'SHUTDOWN' }>
		| undefined
}
export function createSaveArticleMachine(cap: ArticleSaveCapability) {
	const actors = {
		prepare: createAsyncLogic({
			run: ({ input }: { input: SaveArticleRequest }) => cap.prepare(input)
		}),
		read: createAsyncLogic({ run: ({ input }: { input: string }) => cap.read(input) }),
		document: createAsyncLogic({ run: ({ input }: { input: string }) => cap.document(input) }),
		intent: createAsyncLogic({ run: ({ input }: { input: string }) => cap.intent(input) })
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				ENSURE_DONE: types<{ actorId: string; output: ArticleStageResult }>(),
				ENSURE_ERROR: types<{ actorId: string; error: unknown }>(),
				ATTACH_DONE: types<{ actorId: string; output: ArticleStageResult }>(),
				ATTACH_ERROR: types<{ actorId: string; error: unknown }>(),
				CONTENT_DONE: types<{ actorId: string; output: SaveResult }>(),
				CONTENT_ERROR: types<{ actorId: string; error: unknown }>(),
				SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>()
			},
			input: types<SaveArticleRequest>(),
			output: types<ArticleSaveResult>(),
			tags: types<string>(),
			children: {
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				document: types<import('xstate').ActorRefFrom<(typeof actors)['document']>>(),
				intent: types<import('xstate').ActorRefFrom<(typeof actors)['intent']>>()
			}
		},
		actors,
		guards: {
			closing: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'stopping' } }, value),
			stale: () => !cap.isCurrent()
		}
	})

	const draft = ({ context }: { context: Context }) => {
		const d = required(context.draft)
		return {
			attempt: {
				operationId: d.article.id,
				workspaceId: d.article.id,
				membershipId: d.article.id,
				draft: d
			}
		}
	}

	return model.createMachine({
		id: 'save-article',
		initial: 'running',
		context: ({ input }) => ({
			request: input,
			draft: undefined,
			existing: null,
			result: undefined,
			ownedEnsure: undefined,
			ownedAttach: undefined,
			ownedContent: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel' as const,
				states: {
					control: {
						initial: 'active',
						states: { active: { on: { SHUTDOWN: { target: 'stopping' } } }, stopping: {} }
					},
					work: {
						initial: 'admitting',
						states: {
							admitting: {
								type: 'choice',
								choice: (args) => {
									if (args.guards.stale()) {
										return { target: '#save-article.scopeChanged' }
									}
									if (args.guards.closing(args)) {
										return { target: '#save-article.interrupted' }
									}
									return { target: 'preparing' }
								}
							},
							preparing: {
								invoke: {
									id: 'prepare',
									src: 'prepare',
									input: ({ context }: { context: Context }) => required(context.request),
									onDone: (args) => {
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										return {
											target: 'reading',
											context: { draft: args.event.output, request: undefined }
										}
									},
									onError: (args) => {
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										return { target: '#save-article.failed' }
									}
								}
							},
							reading: {
								invoke: {
									id: 'read',
									src: 'read',
									input: ({ context }: { context: Context }) => required(context.draft).article.id,
									onDone: (args) => {
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										return {
											target: 'checking',
											context: (({ context, event }) => {
												const d = required(context.draft)
												const existing = event.output
												return {
													existing,
													draft: existing
														? {
																...d,
																article: existing,
																...(d.content
																	? {
																			content: {
																				...d.content,
																				source: {
																					...required(d.content.source),
																					submittedUrl: existing.url
																				}
																			}
																		}
																	: {})
															}
														: d
												}
											})(args)
										}
									},
									onError: (args) => {
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										return { target: '#save-article.unknown' }
									}
								}
							},
							checking: {
								type: 'choice',
								choice: (args) => {
									if (args.guards.stale()) {
										return { target: '#save-article.scopeChanged' }
									}
									if (args.guards.closing(args)) {
										return { target: '#save-article.interrupted' }
									}
									if (args.context.existing?.contentId) {
										return { target: '#save-article.duplicate' }
									}
									return { target: 'checkingDocument' }
								}
							},
							checkingDocument: {
								invoke: {
									id: 'document',
									src: 'document',
									input: ({ context }: { context: Context }) => required(context.draft).target,
									onDone: (args) => {
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										if (args.event.output !== null) {
											return { target: 'attach' }
										}
										return { target: 'checkingIntent' }
									},
									onError: (args) => {
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										return { target: '#save-article.unknown' }
									}
								}
							},
							checkingIntent: {
								invoke: {
									id: 'intent',
									src: 'intent',
									input: ({ context }: { context: Context }) => required(context.draft).target,
									onDone: (args) => {
										const { context } = args
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										if (!context.draft?.content) {
											return { target: 'ensure' }
										}
										if (args.event.output || !!context.existing?.operationId) {
											return { target: '#save-article.unknown' }
										}
										return { target: 'content' }
									},
									onError: (args) => {
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										return { target: '#save-article.unknown' }
									}
								}
							},
							ensure: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: ({ context }, enq) => {
												enq.sendTo(context.ownedEnsure, { type: 'SHUTDOWN' })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: (args, enq) => {
									const ref = cap.ensure(enq.spawn, draft(args))
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| { type: 'ENSURE_DONE'; actorId: string; output: ArticleStageResult }
											| { type: 'ENSURE_ERROR'; actorId: string; error: unknown } => ({
											type: 'ENSURE_DONE',
											actorId: ref.id,
											output
										}),
										error: (
											error
										):
											| { type: 'ENSURE_DONE'; actorId: string; output: ArticleStageResult }
											| { type: 'ENSURE_ERROR'; actorId: string; error: unknown } => ({
											type: 'ENSURE_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedEnsure: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedEnsure)
									return { context: { ownedEnsure: undefined } }
								},
								on: {
									ENSURE_ERROR: { target: '#save-article.unknown' },
									ENSURE_DONE: (args) => {
										const { context, event } = args
										if (event.actorId !== context.ownedEnsure?.id) return
										if (!event.output || event.output.settlement.kind === 'unresolved')
											return { target: '#save-article.unknown' }
										if (args.guards.stale()) return { target: '#save-article.scopeChanged' }
										if (args.guards.closing(args)) return { target: '#save-article.interrupted' }
										if (event.output.outcome === 'succeeded')
											return {
												target: '#save-article.done',
												context: {
													result: {
														kind: 'saved',
														operationId: required(context.draft).article.id,
														ready: false,
														receipts:
															event.output.settlement.kind === 'locallyPersisted'
																? [event.output.settlement.workspace]
																: []
													}
												}
											}
										if (event.output.outcome === 'blocked') return { target: 'rereading' }
										return { target: '#save-article.failed' }
									}
								}
							},
							attach: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: ({ context }, enq) => {
												enq.sendTo(context.ownedAttach, { type: 'SHUTDOWN' })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: (args, enq) => {
									const ref = cap.attach(enq.spawn, draft(args))
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| { type: 'ATTACH_DONE'; actorId: string; output: ArticleStageResult }
											| { type: 'ATTACH_ERROR'; actorId: string; error: unknown } => ({
											type: 'ATTACH_DONE',
											actorId: ref.id,
											output
										}),
										error: (
											error
										):
											| { type: 'ATTACH_DONE'; actorId: string; output: ArticleStageResult }
											| { type: 'ATTACH_ERROR'; actorId: string; error: unknown } => ({
											type: 'ATTACH_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedAttach: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedAttach)
									return { context: { ownedAttach: undefined } }
								},
								on: {
									ATTACH_ERROR: { target: '#save-article.unknown' },
									ATTACH_DONE: (args) => {
										const { context, event } = args
										if (event.actorId !== context.ownedAttach?.id) return
										if (!event.output || event.output.settlement.kind === 'unresolved')
											return { target: '#save-article.unknown' }
										if (args.guards.stale()) return { target: '#save-article.scopeChanged' }
										if (args.guards.closing(args)) return { target: '#save-article.interrupted' }
										if (event.output.outcome === 'succeeded')
											return {
												target: '#save-article.done',
												context: {
													result: {
														kind: 'duplicate',
														operationId: required(context.draft).article.id,
														ready: true,
														receipts:
															event.output.settlement.kind === 'locallyPersisted'
																? [event.output.settlement.workspace]
																: []
													}
												}
											}
										if (event.output.outcome === 'blocked') return { target: 'rereading' }
										return { target: '#save-article.failed' }
									}
								}
							},
							rereading: {
								invoke: {
									id: 'read',
									src: 'read',
									input: ({ context }: { context: Context }) => required(context.draft).article.id,
									onDone: (args) => {
										const { event } = args
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										if (event.output !== null) {
											return {
												target: '#save-article.duplicate',
												context: { existing: event.output }
											}
										}
										return { target: '#save-article.unknown' }
									},
									onError: (args) => {
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										return { target: '#save-article.unknown' }
									}
								}
							},
							content: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo(args.context.ownedContent, { type: 'SHUTDOWN' as const })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: (args, enq) => {
									const ref = cap.content(
										enq.spawn,
										(({ context }: { context: Context }) =>
											required(required(context.draft).content))(args)
									)
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| ({ type: 'CONTENT_DONE' } & { actorId: string; output: SaveResult })
											| ({ type: 'CONTENT_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'CONTENT_DONE',
											actorId: ref.id,
											output
										}),
										error: (
											error
										):
											| ({ type: 'CONTENT_DONE' } & { actorId: string; output: SaveResult })
											| ({ type: 'CONTENT_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'CONTENT_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedContent: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedContent)
									return { context: { ownedContent: undefined } }
								},
								on: {
									CONTENT_DONE: (args) => {
										const { event } = args
										if (!event.output || event.output.kind === 'unknown') {
											return { target: '#save-article.unknown' }
										}
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										if (event.output?.kind === 'saved') {
											return {
												target: '#save-article.done',
												context: {
													result: {
														kind: 'saved' as const,
														operationId: required(args.context.draft).article.id,
														ready: true,
														receipts: event.output?.kind === 'saved' ? event.output.receipts : []
													}
												}
											}
										}
										return { target: '#save-article.unknown' }
									},
									CONTENT_ERROR: { target: '#save-article.unknown' }
								}
							}
						}
					}
				}
			},
			duplicate: {
				type: 'final' as const,
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: {
								kind: 'duplicate' as const,
								operationId: required(context.draft).article.id,
								ready: !!context.existing?.contentId,
								receipts: []
							},
							request: undefined,
							draft: undefined,
							existing: null
						}
					}
				}
			},
			done: {
				type: 'final' as const,
				entry: () => {
					return { context: { request: undefined, draft: undefined, existing: null } }
				}
			},
			failed: {
				type: 'final' as const,
				entry: (args) => {
					return {
						context: {
							result: { kind: 'failed', operationId: args.context.draft?.article.id ?? '' },
							request: undefined,
							draft: undefined,
							existing: null
						}
					}
				}
			},
			unknown: {
				type: 'final' as const,
				entry: (args) => {
					return {
						context: {
							result: { kind: 'unknown', operationId: args.context.draft?.article.id ?? '' },
							request: undefined,
							draft: undefined,
							existing: null
						}
					}
				}
			},
			interrupted: {
				type: 'final' as const,
				entry: (args) => {
					return {
						context: {
							result: { kind: 'interrupted', operationId: args.context.draft?.article.id ?? '' },
							request: undefined,
							draft: undefined,
							existing: null
						}
					}
				}
			},
			scopeChanged: {
				type: 'final' as const,
				entry: (args) => {
					return {
						context: {
							result: { kind: 'scopeChanged', operationId: args.context.draft?.article.id ?? '' },
							request: undefined,
							draft: undefined,
							existing: null
						}
					}
				}
			}
		}
	})
}
