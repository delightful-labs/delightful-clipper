import { assign, enqueueActions, fromPromise, setup } from 'xstate'
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
	closing: boolean
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
		{ close: undefined },
		{ closing: undefined; stale: undefined },
		never,
		string,
		SaveArticleRequest,
		ArticleSaveResult
	>({
		actors,
		guards: { closing: ({ context }) => context.closing, stale: () => !cap.isCurrent() },
		actions: {
			close: enqueueActions(({ self, enqueue }) => {
				enqueue.assign({ closing: true })
				for (const id of ['ensure', 'attach', 'content'])
					if (self.getSnapshot().children[id]) enqueue.sendTo(id, { type: 'SHUTDOWN' })
			})
		}
	})
	const interrupts = [
		{ guard: 'stale' as const, target: 'scopeChanged' },
		{ guard: 'closing' as const, target: 'interrupted' }
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
			invoke: {
				id: src,
				src,
				input: draft,
				onDone: [
					{
						guard: ({ event }) => !event.output || event.output.settlement.kind === 'unresolved',
						target: 'unknown'
					},
					...interrupts,
					{
						guard: ({ event }) => event.output?.settlement.kind === 'locallyPersisted',
						target: 'done',
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
					{ target: 'failed' }
				],
				onError: 'unknown'
			}
		})
	return model.createMachine({
		id: 'save-article',
		initial: 'preparing',
		context: ({ input }) => ({
			request: input,
			draft: undefined,
			existing: null,
			closing: false,
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		on: { SHUTDOWN: { actions: 'close' } },
		states: {
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
					onError: [...interrupts, { target: 'failed' }]
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
					onError: [...interrupts, { target: 'unknown' }]
				}
			},
			checking: {
				always: [
					...interrupts,
					{ guard: ({ context }) => !!context.existing?.contentId, target: 'duplicate' },
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
					onError: [...interrupts, { target: 'unknown' }]
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
							target: 'unknown'
						},
						{ target: 'content' }
					],
					onError: [...interrupts, { target: 'unknown' }]
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
							target: 'duplicate',
							actions: assign({ existing: ({ event }) => event.output })
						},
						{ target: 'unknown' }
					],
					onError: 'unknown'
				}
			},
			content: {
				invoke: {
					id: 'content',
					src: 'content',
					input: ({ context }) => required(required(context.draft).content),
					onDone: [
						{
							guard: ({ event }) => !event.output || event.output.kind === 'unknown',
							target: 'unknown'
						},
						...interrupts,
						{
							guard: ({ event }) => event.output?.kind === 'saved',
							target: 'done',
							actions: assign({
								result: ({ context, event }) => ({
									kind: 'saved',
									operationId: required(context.draft).article.id,
									ready: true,
									receipts: event.output?.kind === 'saved' ? event.output.receipts : []
								})
							})
						},
						{ target: 'unknown' }
					],
					onError: 'unknown'
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
