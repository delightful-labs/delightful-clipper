import { assign, fromPromise, setup, stateIn, sendTo } from 'xstate'
import type { Snapshot } from 'xstate'
import type {
	Article,
	ArticleDraft,
	ArticleSaveCapability,
	ArticleSaveResult,
	ArticleStageResult,
	SaveArticleRequest
} from '../../contracts/articles.js'
import type { SaveResult, SyncReceipt } from '../../contracts/storage.js'
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
export function createSaveArticleMachine<
	S extends Snapshot<ArticleStageResult>,
	C extends Snapshot<SaveResult>
>(cap: ArticleSaveCapability<S, C>) {
	const actors = {
		prepare: fromPromise(({ input }: { input: SaveArticleRequest }) => cap.prepare(input)),
		read: fromPromise(({ input }: { input: string }) => cap.read(input)),
		document: fromPromise(({ input }: { input: string }) => cap.document(input)),
		intent: fromPromise(({ input }: { input: string }) => cap.intent(input)),
		ensure: cap.ensure,
		attach: cap.attach,
		content: cap.content
	}
	const model = setup<
		Context,
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{},
		{ closing: undefined; stale: undefined },
		never,
		string,
		SaveArticleRequest,
		ArticleSaveResult
	>({
		actors,
		guards: {
			closing: stateIn({ running: { control: 'stopping' } }),
			stale: () => !cap.isCurrent()
		}
	})
	const interrupts = [
		{ guard: 'stale' as const, target: '#save-article.scopeChanged' },
		{ guard: 'closing' as const, target: '#save-article.interrupted' }
	]
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
	const terminal = (kind: 'failed' | 'unknown' | 'interrupted' | 'scopeChanged') =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }) => ({ kind, operationId: context.draft?.article.id ?? '' }),
				request: undefined,
				draft: undefined,
				existing: null
			})
		})
	const stage = (src: 'ensure' | 'attach') =>
		model.createStateConfig({
			initial: 'active',
			states: {
				active: {
					on: { SHUTDOWN: { target: 'stopping', actions: sendTo(src, { type: 'SHUTDOWN' }) } }
				},
				stopping: {}
			},
			invoke: {
				id: src,
				src,
				input: draft,
				onDone: [
					{
						guard: ({ event }) => !event.output || event.output.settlement.kind === 'unresolved',
						target: '#save-article.unknown'
					},
					...interrupts,
					{
						guard: ({ event }) => event.output?.settlement.kind === 'locallyPersisted',
						target: '#save-article.done',
						actions: assign({
							result: ({ context, event }) => {
								const receipts: SyncReceipt[] =
									event.output?.settlement.kind === 'locallyPersisted'
										? [event.output.settlement.workspace]
										: []
								return {
									kind: src === 'attach' ? 'duplicate' : 'saved',
									operationId: required(context.draft).article.id,
									ready: src === 'attach',
									receipts
								}
							}
						})
					},
					{ guard: ({ event }) => event.output?.outcome === 'blocked', target: 'rereading' },
					{ target: '#save-article.failed' }
				],
				onError: '#save-article.unknown'
			}
		})
	const work = model.createStateConfig({
		initial: 'admitting',
		states: {
			admitting: { always: [...interrupts, { target: 'preparing' }] },
			preparing: {
				invoke: {
					src: 'prepare',
					input: ({ context }) => required(context.request),
					onDone: [
						...interrupts,
						{
							target: 'reading',
							actions: assign({ draft: ({ event }) => event.output, request: undefined })
						}
					],
					onError: [...interrupts, { target: '#save-article.failed' }]
				}
			},
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => required(context.draft).article.id,
					onDone: [
						...interrupts,
						{
							target: 'checking',
							actions: assign(({ context, event }) => {
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
							})
						}
					],
					onError: [...interrupts, { target: '#save-article.unknown' }]
				}
			},
			checking: {
				always: [
					...interrupts,
					{
						guard: ({ context }) => !!context.existing?.contentId,
						target: '#save-article.duplicate'
					},
					{ target: 'checkingDocument' }
				]
			},
			checkingDocument: {
				invoke: {
					src: 'document',
					input: ({ context }) => required(context.draft).target,
					onDone: [
						...interrupts,
						{ guard: ({ event }) => event.output !== null, target: 'attach' },
						{ target: 'checkingIntent' }
					],
					onError: [...interrupts, { target: '#save-article.unknown' }]
				}
			},
			checkingIntent: {
				invoke: {
					src: 'intent',
					input: ({ context }) => required(context.draft).target,
					onDone: [
						...interrupts,
						{ guard: ({ context }) => !context.draft?.content, target: 'ensure' },
						{
							guard: ({ context, event }) => event.output || !!context.existing?.operationId,
							target: '#save-article.unknown'
						},
						{ target: 'content' }
					],
					onError: [...interrupts, { target: '#save-article.unknown' }]
				}
			},
			ensure: stage('ensure'),
			attach: stage('attach'),
			rereading: {
				invoke: {
					src: 'read',
					input: ({ context }) => required(context.draft).article.id,
					onDone: [
						...interrupts,
						{
							guard: ({ event }) => event.output !== null,
							target: '#save-article.duplicate',
							actions: assign({ existing: ({ event }) => event.output })
						},
						{ target: '#save-article.unknown' }
					],
					onError: [...interrupts, { target: '#save-article.unknown' }]
				}
			},
			content: {
				initial: 'active',
				states: {
					active: {
						on: {
							SHUTDOWN: {
								target: 'stopping',
								actions: sendTo('content', { type: 'SHUTDOWN' })
							}
						}
					},
					stopping: {}
				},
				invoke: {
					id: 'content',
					src: 'content',
					input: ({ context }) => required(required(context.draft).content),
					onDone: [
						{
							guard: ({ event }) => !event.output || event.output.kind === 'unknown',
							target: '#save-article.unknown'
						},
						...interrupts,
						{
							guard: ({ event }) => event.output?.kind === 'saved',
							target: '#save-article.done',
							actions: assign({
								result: ({ context, event }) => ({
									kind: 'saved',
									operationId: required(context.draft).article.id,
									ready: true,
									receipts: event.output?.kind === 'saved' ? event.output.receipts : []
								})
							})
						},
						{ target: '#save-article.unknown' }
					],
					onError: '#save-article.unknown'
				}
			}
		}
	})
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
						states: { active: { on: { SHUTDOWN: 'stopping' } }, stopping: {} }
					},
					work
				}
			},
			duplicate: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({
						kind: 'duplicate',
						operationId: required(context.draft).article.id,
						ready: !!context.existing?.contentId,
						receipts: []
					}),
					request: undefined,
					draft: undefined,
					existing: null
				})
			},
			done: {
				type: 'final',
				entry: assign({ request: undefined, draft: undefined, existing: null })
			},
			failed: terminal('failed'),
			unknown: terminal('unknown'),
			interrupted: terminal('interrupted'),
			scopeChanged: terminal('scopeChanged')
		}
	})
}
