import { createActor, setup, toPromise } from 'xstate'
import type { SyncReceipt } from '../../contracts/storage.js'
type Receipt = { receipt: () => SyncReceipt }
type IntentInput = Receipt & {
	articleLinked: boolean
	existingArticle: boolean
	insertIntent: () => void
	createArticle: () => void
	bindArticle: () => void
}
type PublicationInput = Receipt & {
	articleLinked: boolean
	hasSource: boolean
	publishContent: () => void
	attachContent: () => void
	publishSource: () => void
}
type AttachmentInput = Receipt & {
	existingArticle: boolean
	createArticle: () => void
	attachContent: () => void
}
/** Mutation charts run wholly inside the transaction owner's staging invocation.
 * They never commit: failures return to that owner for rollback; shutdown drains staging.
 */
export const intentMutationMachine = setup<
	IntentInput,
	{ type: 'UNUSED' },
	{},
	{},
	{},
	{},
	never,
	string,
	IntentInput,
	SyncReceipt
>({}).createMachine({
	id: 'storage-intent-mutations',
	context: ({ input }) => input,
	initial: 'insertingIntent',
	output: ({ context }) => context.receipt(),
	states: {
		insertingIntent: { entry: ({ context }) => context.insertIntent(), always: 'routingArticle' },
		routingArticle: {
			always: [
				{ guard: ({ context }) => !context.articleLinked, target: 'done' },
				{ guard: ({ context }) => context.existingArticle, target: 'bindingArticle' },
				{ target: 'creatingArticle' }
			]
		},
		bindingArticle: { entry: ({ context }) => context.bindArticle(), always: 'done' },
		creatingArticle: { entry: ({ context }) => context.createArticle(), always: 'done' },
		done: { type: 'final' }
	}
})
export const publicationMutationMachine = setup<
	PublicationInput,
	{ type: 'UNUSED' },
	{},
	{},
	{},
	{},
	never,
	string,
	PublicationInput,
	SyncReceipt
>({}).createMachine({
	id: 'storage-publication-mutations',
	context: ({ input }) => input,
	initial: 'publishingContent',
	output: ({ context }) => context.receipt(),
	states: {
		publishingContent: {
			entry: ({ context }) => context.publishContent(),
			always: 'routingArticle'
		},
		routingArticle: {
			always: [
				{ guard: ({ context }) => context.articleLinked, target: 'attachingContent' },
				{ target: 'routingSource' }
			]
		},
		attachingContent: { entry: ({ context }) => context.attachContent(), always: 'routingSource' },
		routingSource: {
			always: [
				{ guard: ({ context }) => context.hasSource, target: 'publishingSource' },
				{ target: 'done' }
			]
		},
		publishingSource: { entry: ({ context }) => context.publishSource(), always: 'done' },
		done: { type: 'final' }
	}
})
export const attachmentMutationMachine = setup<
	AttachmentInput,
	{ type: 'UNUSED' },
	{},
	{},
	{},
	{},
	never,
	string,
	AttachmentInput,
	SyncReceipt
>({}).createMachine({
	id: 'article-attachment-mutations',
	context: ({ input }) => input,
	initial: 'routingArticle',
	output: ({ context }) => context.receipt(),
	states: {
		routingArticle: {
			always: [
				{ guard: ({ context }) => context.existingArticle, target: 'attachingContent' },
				{ target: 'creatingArticle' }
			]
		},
		attachingContent: { entry: ({ context }) => context.attachContent(), always: 'done' },
		creatingArticle: { entry: ({ context }) => context.createArticle(), always: 'done' },
		done: { type: 'final' }
	}
})
/** Each chart is synchronous staging; its parent retains the transaction until completion. */
export function stageIntent(input: IntentInput) {
	const actor = createActor(intentMutationMachine, { input })
	const result = toPromise(actor)
	actor.start()
	return result.finally(() => actor.stop())
}
export function stagePublication(input: PublicationInput) {
	const actor = createActor(publicationMutationMachine, { input })
	const result = toPromise(actor)
	actor.start()
	return result.finally(() => actor.stop())
}
export function stageAttachment(input: AttachmentInput) {
	const actor = createActor(attachmentMutationMachine, { input })
	const result = toPromise(actor)
	actor.start()
	return result.finally(() => actor.stop())
}
