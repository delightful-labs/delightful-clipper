import { assign, sendTo, setup, type ActorRef, type Snapshot, type SnapshotFrom } from 'xstate'
import type { LibraryEvent } from '../../contracts/library.js'
import { tagSelectionChange, type Tag, type TagSelectionChange } from '../../capture/tags.js'
import { stateFeedback } from '../../contracts/feedback.js'
import { t, noun } from '../../localization/index.js'
export type TagFormEvent =
	| { type: 'SELECT'; id: string; names: string[]; previous: Tag[]; enabled: boolean }
	| { type: 'RESET' }
type Library = ActorRef<Snapshot<unknown>, LibraryEvent>
type Context = { library: Library; id: string; change: TagSelectionChange; revision: number }
function membership(change: TagSelectionChange) {
	if (change.kind !== 'changed') throw new Error('Expected one tag membership change')
	return change
}
/** DUI owns editing/chips/suggestions; this actor validates and delegates one native membership change. */
const tagFormModel = setup<
	Context,
	TagFormEvent,
	{},
	{},
	{},
	{},
	never,
	string,
	{ library: Library }
>({}).extend({
	actions: {
		submitMembership: sendTo(
			({ context }) => context.library,
			({ context }) =>
				({
					type: 'ORGANIZE',
					request: {
						id: context.id,
						field: 'tag',
						value: membership(context.change).name,
						assigned: membership(context.change).assigned
					}
				}) satisfies LibraryEvent
		)
	}
})
export const tagFormMachine = tagFormModel.createMachine({
	id: 'article-tag-form',
	initial: 'editing',
	context: ({ input }) => ({
		library: input.library,
		id: '',
		change: { kind: 'unchanged' },
		revision: 0
	}),
	on: {
		RESET: { target: '.editing' },
		SELECT: [
			{ guard: ({ event }) => !event.enabled },
			{
				target: '.validating',
				actions: assign({
					id: ({ event }) => event.id,
					change: ({ event }) => tagSelectionChange(event.previous, event.names),
					revision: ({ context }) => context.revision + 1
				})
			}
		]
	},
	states: {
		editing: {},
		validating: {
			always: [
				{ guard: ({ context }) => context.change.kind === 'invalid', target: 'invalid' },
				{
					guard: ({ context }) => context.change.kind === 'changed',
					target: 'editing',
					actions: 'submitMembership'
				},
				{ target: 'editing' }
			]
		},
		invalid: {
			meta: { name: t('forms.enter_subject', { subject: noun('tag') }), variant: 'error' }
		}
	}
})
export function selectTagFormView(snapshot: SnapshotFrom<typeof tagFormMachine> | undefined) {
	return {
		revision: snapshot?.context.revision ?? 0,
		message: snapshot ? stateFeedback(Object.values(snapshot.getMeta())) : undefined
	}
}
