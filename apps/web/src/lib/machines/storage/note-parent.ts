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
	{ insertArticle: undefined; insertDocument: undefined; failUnavailable: undefined },
	{ hasNote: undefined; hasArticle: undefined; hasDocument: undefined },
	never,
	string,
	Input,
	SyncReceipt
>({
	guards: {
		hasNote: ({ context }) => !!context.note,
		hasArticle: ({ context }) => !!context.article,
		hasDocument: ({ context }) => !!context.document
	},
	actions: {
		insertArticle: ({ context }) => context.insertArticle(),
		insertDocument: ({ context }) => context.insertDocument(),
		failUnavailable: () => {
			throw new Error('Note parent unavailable')
		}
	}
}).createMachine({
	id: 'note-parent-mutation',
	context: ({ input }) => input,
	initial: 'selectingParent',
	output: ({ context }) => context.receipt(),
	states: {
		selectingParent: {
			always: [
				{ guard: 'hasNote', target: 'done' },
				{ guard: 'hasArticle', target: 'article' },
				{ guard: 'hasDocument', target: 'document' },
				{ target: 'unavailable' }
			]
		},
		article: { entry: 'insertArticle', always: 'done' },
		document: { entry: 'insertDocument', always: 'done' },
		unavailable: { entry: 'failUnavailable' },
		done: { type: 'final' }
	}
})
export function stageNoteParent(input: Input) {
	const actor = createActor(noteParentMachine, { input })
	const result = toPromise(actor)
	actor.start()
	return result.finally(() => actor.stop())
}
