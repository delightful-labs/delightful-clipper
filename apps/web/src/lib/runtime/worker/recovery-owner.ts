import type { EventPayload } from '../../machines/events.js'
import { types, createCallbackLogic, setup, type ActorFromLogic } from 'xstate'

import type { RecoveryBinding } from '../../contracts/account.js'
import type { RecoveryPhraseEvent } from 'delightful-local-first/recovery/contracts'
import {
	createRecoveryPhraseMachine,
	selectRecoveryPhraseView
} from 'delightful-local-first/recovery/workflow'
/** One fixed DLF capability/source pair per binding. Its parent owns replacement;
 * stopping cancels a resource-free phrase read, never a persistence operation. */
type Event =
	| { type: 'REVEAL' }
	| { type: 'RETRY' }
	| { type: 'HIDE' }
	| { type: 'SHUTDOWN' }
	| Extract<RecoveryPhraseEvent, { type: 'OBSERVE' }>
export function createRecoveryOwner(binding: RecoveryBinding) {
	const phrase = createRecoveryPhraseMachine(binding.capability)
	const observation = createCallbackLogic<RecoveryPhraseEvent>(({ sendBack }) =>
		binding.source.subscribe((scope) => sendBack({ type: 'OBSERVE' as const, scope }))
	)
	return setup({
		schemas: {
			context: types<{}>(),
			events: {
				REVEAL: types<EventPayload<Event, 'REVEAL'>>(),
				RETRY: types<EventPayload<Event, 'RETRY'>>(),
				HIDE: types<EventPayload<Event, 'HIDE'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				OBSERVE: types<EventPayload<Event, 'OBSERVE'>>()
			},
			children: {
				phrase: types<import('xstate').ActorFromLogic<typeof phrase>>(),
				observation: types<import('xstate').ActorFromLogic<typeof observation>>()
			}
		},
		actors: { phrase, observation }
	}).createMachine({
		id: 'worker-recovery-owner',
		initial: 'active',
		context: {},
		invoke: {
			id: 'phrase',
			src: 'phrase',
			input: { kind: 'unavailable' as const },
			onDone: { target: '.closed' }
		},
		states: {
			active: {
				invoke: { id: 'observation', src: 'observation' },
				on: {
					OBSERVE: (args, enq) => {
						const { event } = args
						enq.sendTo('phrase', event)
					},
					REVEAL: (args, enq) => {
						enq.sendTo('phrase', { type: 'REVEAL' as const })
					},
					RETRY: (args, enq) => {
						enq.sendTo('phrase', { type: 'RETRY' as const })
					},
					HIDE: (args, enq) => {
						enq.sendTo('phrase', { type: 'HIDE' as const })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('phrase', { type: 'SHUTDOWN' as const })
						return { target: 'draining' }
					}
				}
			},
			draining: {},
			closed: { type: 'final' as const }
		}
	})
}
export type RecoveryOwner = ActorFromLogic<ReturnType<typeof createRecoveryOwner>>
export function recoveryView(owner: RecoveryOwner | undefined) {
	const phrase = owner?.getSnapshot().children.phrase?.getSnapshot()
	return phrase ? selectRecoveryPhraseView(phrase) : { kind: 'unavailable' as const }
}
