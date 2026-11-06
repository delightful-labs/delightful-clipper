import { createActor, setup, toPromise } from 'xstate'
import type { SyncReceipt } from '../../contracts/storage.js'

type Input = {
	note?: unknown
	article: unknown
	document: unknown
	insertArticle: () => void
	insertDocument: () => void
	receipt: () => SyncReceipt
}
/** Select the native reference from the transaction's checked parent rows.
 * The DLF transaction owner retains staging, rollback and commit ownership. */
const noteParentMachine = setup<
	Input,
	{ type: 'UNUSED' },
	{},
	{},
	{},
	{},
	never,
	string,
	Input,
	SyncReceipt
>({}).createMachine({
	id: 'note-parent-mutation',
	context: ({ input }) => input,
	initial: 'selectingParent',
	output: ({ context }) => context.receipt(),
	states: {
		selectingParent: {
			always: [
				{ guard: ({ context }) => !!context.note, target: 'done' },
				{ guard: ({ context }) => !!context.article, target: 'article' },
				{ guard: ({ context }) => !!context.document, target: 'document' },
				{ target: 'unavailable' }
			]
		},
		article: { entry: ({ context }) => context.insertArticle(), always: 'done' },
		document: { entry: ({ context }) => context.insertDocument(), always: 'done' },
		unavailable: {
			entry: () => {
				throw new Error('Note parent unavailable')
			}
		},
		done: { type: 'final' }
	}
})
export function stageNoteParent(input: Input) {
	const actor = createActor(noteParentMachine, { input })
	const result = toPromise(actor)
	actor.start()
	return result.finally(() => actor.stop())
}
