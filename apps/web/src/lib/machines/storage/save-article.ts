import { appendLocalReceipt } from './receipts.js'
import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
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
}
export function createSaveArticleMachine(cap: ArticleSaveCapability) {
	const actors = {
		prepare: createAsyncLogic({
			run: ({ input }: { input: SaveArticleRequest }) => cap.prepare(input)
		}),
		read: createAsyncLogic({ run: ({ input }: { input: string }) => cap.read(input) }),
		document: createAsyncLogic({ run: ({ input }: { input: string }) => cap.document(input) }),
		intent: createAsyncLogic({ run: ({ input }: { input: string }) => cap.intent(input) }),
		stage: createOwnedOperation<
			Parameters<ArticleSaveCapability['ensure']>[1],
			ArticleStageResult,
			{ type: 'SHUTDOWN' }
		>(),
		contentSave: createOwnedOperation<
			Parameters<ArticleSaveCapability['content']>[1],
			SaveResult,
			{ type: 'SHUTDOWN' }
		>()
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>()
			},
			input: types<SaveArticleRequest>(),
			output: types<ArticleSaveResult>(),
			tags: types<string>(),
			children: {
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				document: types<import('xstate').ActorRefFrom<(typeof actors)['document']>>(),
				intent: types<import('xstate').ActorRefFrom<(typeof actors)['intent']>>(),
				ensure: types<import('xstate').ActorRefFrom<typeof actors.stage>>(),
				attach: types<import('xstate').ActorRefFrom<typeof actors.stage>>(),
				content: types<import('xstate').ActorRefFrom<typeof actors.contentSave>>()
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
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
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
								invoke: {
									id: 'ensure',
									src: 'stage',
									input: ({ context }) => ({
										operationId: required(context.draft).article.id,
										spawn: cap.ensure,
										input: draft({ context })
									}),
									onDone: (args) => {
										const operation = args.event.output
										if (operation.kind === 'failed') return { target: '#save-article.unknown' }
										const output = operation.output

										const { context } = args

										if (!output || output.settlement.kind === 'unresolved')
											return { target: '#save-article.unknown' }
										if (args.guards.stale()) return { target: '#save-article.scopeChanged' }
										if (args.guards.closing(args)) return { target: '#save-article.interrupted' }
										if (output.outcome === 'succeeded')
											return {
												target: '#save-article.done',
												context: {
													result: {
														kind: 'saved',
														operationId: required(context.draft).article.id,
														ready: false,
														receipts: appendLocalReceipt([], output.settlement)
													}
												}
											}
										if (output.outcome === 'blocked') return { target: 'rereading' }
										return { target: '#save-article.failed' }
									},
									onError: { target: '#save-article.unknown' }
								},
								on: {
									SHUTDOWN: (_, enq) => {
										enq.sendTo('ensure', { type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
									}
								}
							},
							attach: {
								invoke: {
									id: 'attach',
									src: 'stage',
									input: ({ context }) => ({
										operationId: required(context.draft).article.id,
										spawn: cap.attach,
										input: draft({ context })
									}),
									onDone: (args) => {
										const operation = args.event.output
										if (operation.kind === 'failed') return { target: '#save-article.unknown' }
										const output = operation.output

										const { context } = args

										if (!output || output.settlement.kind === 'unresolved')
											return { target: '#save-article.unknown' }
										if (args.guards.stale()) return { target: '#save-article.scopeChanged' }
										if (args.guards.closing(args)) return { target: '#save-article.interrupted' }
										if (output.outcome === 'succeeded')
											return {
												target: '#save-article.done',
												context: {
													result: {
														kind: 'duplicate',
														operationId: required(context.draft).article.id,
														ready: true,
														receipts: appendLocalReceipt([], output.settlement)
													}
												}
											}
										if (output.outcome === 'blocked') return { target: 'rereading' }
										return { target: '#save-article.failed' }
									},
									onError: { target: '#save-article.unknown' }
								},
								on: {
									SHUTDOWN: (_, enq) => {
										enq.sendTo('attach', { type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
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
								invoke: {
									id: 'content',
									src: 'contentSave',
									input: ({ context }) => ({
										operationId: required(required(context.draft).content).operationId,
										spawn: cap.content,
										input: required(required(context.draft).content)
									}),
									onDone: (args) => {
										const operation = args.event.output
										if (operation.kind === 'failed') return { target: '#save-article.unknown' }
										const output = operation.output

										if (!output || output.kind === 'unknown') {
											return { target: '#save-article.unknown' }
										}
										if (args.guards.stale()) {
											return { target: '#save-article.scopeChanged' }
										}
										if (args.guards.closing(args)) {
											return { target: '#save-article.interrupted' }
										}
										if (output?.kind === 'saved') {
											return {
												target: '#save-article.done',
												context: {
													result: {
														kind: 'saved',
														operationId: required(args.context.draft).article.id,
														ready: true,
														receipts: output?.kind === 'saved' ? output.receipts : []
													}
												}
											}
										}
										return { target: '#save-article.unknown' }
									},
									onError: { target: '#save-article.unknown' }
								},
								on: {
									SHUTDOWN: (_, enq) => {
										enq.sendTo('content', { type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
									}
								}
							}
						}
					}
				}
			},
			duplicate: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: {
								kind: 'duplicate',
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
				type: 'final',
				entry: () => {
					return { context: { request: undefined, draft: undefined, existing: null } }
				}
			},
			failed: {
				type: 'final',
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
				type: 'final',
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
				type: 'final',
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
				type: 'final',
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
