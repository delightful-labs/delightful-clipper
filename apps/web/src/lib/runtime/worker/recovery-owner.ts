import { fromCallback, sendTo, setup } from 'xstate'
import type { ActorRefFrom } from 'xstate'
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
	const observation = fromCallback<RecoveryPhraseEvent>(({ sendBack }) =>
		binding.source.subscribe((scope) => sendBack({ type: 'OBSERVE', scope }))
	)
	return setup<
		{},
		Event,
		{ phrase: typeof phrase; observation: typeof observation },
		{ phrase: 'phrase' }
	>({ actors: { phrase, observation } }).createMachine({
		id: 'worker-recovery-owner',
		initial: 'active',
		context: {},
		invoke: { id: 'phrase', src: 'phrase', input: { kind: 'unavailable' }, onDone: '.closed' },
		states: {
			active: {
				invoke: { src: 'observation' },
				on: {
					OBSERVE: { actions: sendTo('phrase', ({ event }) => event) },
					REVEAL: { actions: sendTo('phrase', { type: 'REVEAL' }) },
					RETRY: { actions: sendTo('phrase', { type: 'RETRY' }) },
					HIDE: { actions: sendTo('phrase', { type: 'HIDE' }) },
					SHUTDOWN: { target: 'draining', actions: sendTo('phrase', { type: 'SHUTDOWN' }) }
				}
			},
			draining: {},
			closed: { type: 'final' }
		}
	})
}
export type RecoveryOwner = ActorRefFrom<ReturnType<typeof createRecoveryOwner>>
export function recoveryView(owner: RecoveryOwner | undefined) {
	const phrase = owner?.getSnapshot().children.phrase?.getSnapshot()
	return phrase ? selectRecoveryPhraseView(phrase) : { kind: 'unavailable' as const }
}
