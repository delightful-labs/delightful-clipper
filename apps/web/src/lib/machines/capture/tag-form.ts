import type { EventPayload } from '../events.js'
import { types, setup, type ActorRef, type Snapshot, type SnapshotFrom } from 'xstate'

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
const tagFormModel = setup({
	schemas: {
		meta: types<{
			name?: string
			variant?: 'info' | 'error'
			channel?: string
			priority?: number
		}>(),
		context: types<Context>(),
		events: {
			SELECT: types<EventPayload<TagFormEvent, 'SELECT'>>(),
			RESET: types<EventPayload<TagFormEvent, 'RESET'>>()
		},
		input: types<{ library: Library }>(),
		tags: types<string>()
	},
	actions: {}
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
		SELECT: (args) => {
			const { event } = args
			if (!event.enabled) {
				return {}
			}
			return {
				target: '.validating',
				context: {
					id: event.id,
					change: tagSelectionChange(event.previous, event.names),
					revision: args.context.revision + 1
				}
			}
		}
	},
	states: {
		editing: {},
		validating: {
			always: (args, enq) => {
				const { context } = args
				if (context.change.kind === 'invalid') {
					return { target: 'invalid' }
				}
				if (context.change.kind === 'changed') {
					enq.sendTo(context.library, {
						type: 'ORGANIZE',
						request: {
							id: context.id,
							field: 'tag',
							value: membership(context.change).name,
							assigned: membership(context.change).assigned
						}
					} satisfies LibraryEvent)
					return { target: 'editing' }
				}
				return { target: 'editing' }
			}
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
