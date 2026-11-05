import { assign, sendTo, setup, type ActorRef, type Snapshot, type SnapshotFrom } from 'xstate'
import type { LibraryEvent } from '../../contracts/library.js'
import { isValidTagName } from '../../capture/tags.js'
import { stateFeedback } from '../../contracts/feedback.js'
import { t, noun } from '../../localization/index.js'

export type TagFormEvent =
	| { type: 'CHANGE'; name: string }
	| { type: 'SUBMIT'; id: string; enabled: boolean }
	| { type: 'RESET' }
/** Validation is synchronous; the library retains all native write/receipt ownership. */
type Library = ActorRef<Snapshot<unknown>, LibraryEvent>
export const tagFormMachine = setup<
	{ name: string; library: Library },
	TagFormEvent,
	{},
	{},
	{},
	{},
	never,
	string,
	{ library: Library }
>({}).createMachine({
	id: 'article-tag-form',
	initial: 'editing',
	context: ({ input }) => ({ name: '', library: input.library }),
	on: {
		CHANGE: { target: '.editing', actions: assign({ name: ({ event }) => event.name }) },
		RESET: { target: '.editing', actions: assign({ name: '' }) },
		SUBMIT: [
			{ guard: ({ event }) => !event.enabled },
			{
				guard: ({ context }) => isValidTagName(context.name),
				target: '.editing',
				actions: [
					sendTo(
						({ context }) => context.library,
						({ context, event }) =>
							({
								type: 'ORGANIZE',
								request: { id: event.id, field: 'tag', value: context.name, assigned: true }
							}) satisfies LibraryEvent
					),
					assign({ name: '' })
				]
			},
			{ target: '.invalid' }
		]
	},
	states: {
		editing: {},
		invalid: {
			meta: { name: t('forms.enter_subject', { subject: noun('tag') }), variant: 'error' }
		}
	}
})
export function selectTagFormView(snapshot: SnapshotFrom<typeof tagFormMachine> | undefined) {
	return {
		name: snapshot?.context.name ?? '',
		invalid: snapshot?.matches('invalid') ?? false,
		message: snapshot ? stateFeedback(Object.values(snapshot.getMeta())) : undefined
	}
}
