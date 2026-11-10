import { createCallbackLogic } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import {
	selectLibraryActor,
	selectRecoveryBinding
} from '../../machines/runtime/application-readiness.js'
import type { ApplicationSnapshot } from '../../machines/runtime/application-readiness.js'
import type { Session } from '../../backend/jazz/account.js'
import type { libraryMachine } from '../../machines/capture/library.js'
import type { tagFormMachine } from '../../machines/capture/tag-form.js'
import type { RecoveryBinding } from '../../contracts/account.js'
import type { RecoveryOwner } from './recovery-owner.js'

type Observable = {
	subscribe(observer: { next: () => void; error: () => void }): { unsubscribe: () => void }
}
type Library = ActorRefFrom<typeof libraryMachine>
export type ApplicationBindingFacts = {
	library: Library | undefined
	recovery: RecoveryBinding | undefined
}
export function applicationBindingFacts(
	snapshot: ApplicationSnapshot<Session>
): ApplicationBindingFacts {
	return { library: selectLibraryActor(snapshot), recovery: selectRecoveryBinding(snapshot) }
}
export function sameApplicationBinding(
	left: ApplicationBindingFacts,
	right: ApplicationBindingFacts
) {
	return (
		left.library === right.library &&
		left.recovery?.capability === right.recovery?.capability &&
		left.recovery?.source === right.recovery?.source
	)
}
export function libraryBindingFacts(library: Library) {
	const snapshot = library.getSnapshot()
	return {
		library,
		active:
			snapshot.matches({ running: { control: 'active' } }) &&
			snapshot.context.capability?.isCurrent() === true,
		documentId:
			snapshot.context.reader?.kind === 'available'
				? snapshot.context.reader.document.snapshotId
				: undefined,
		tags: Object.fromEntries(snapshot.context.rows.map((row) => [row.id, row.tags]))
	}
}
/** Native subscriptions only. The host selects the binding and consumes these
 * facts; publication never adopts resources or scans reader internals. */
export const bindingObservation = createCallbackLogic<
	never,
	{
		library: Library | undefined
		tagForm: ActorRefFrom<typeof tagFormMachine> | undefined
		recovery: RecoveryOwner | undefined
		generation: number
	}
>(({ input, sendBack }) => {
	const subscriptions = new Map<object, { unsubscribe: () => void }>()
	let updating = false,
		disposed = false
	const update = () => {
		if (updating || disposed) return
		updating = true
		try {
			const watched: Observable[] = [
				input.library,
				input.tagForm,
				input.recovery,
				input.recovery?.getSnapshot().children.phrase,
				...Object.values(input.library?.getSnapshot().children ?? {})
			].filter((ref) => ref !== undefined)
			for (const [reference, subscription] of subscriptions) {
				if (!watched.some((ref) => ref === reference)) {
					subscription.unsubscribe()
					subscriptions.delete(reference)
				}
			}
			for (const reference of watched) {
				if (!subscriptions.has(reference))
					subscriptions.set(
						reference,
						reference.subscribe({
							next: update,
							error: () => sendBack({ type: 'BINDING_FAILED', generation: input.generation })
						})
					)
			}
			if (input.library)
				sendBack({
					type: 'LIBRARY_OBSERVED',
					generation: input.generation,
					facts: libraryBindingFacts(input.library)
				})
			else sendBack({ type: 'RENDER' })
		} finally {
			updating = false
		}
	}
	update()
	return () => {
		disposed = true
		for (const subscription of subscriptions.values()) subscription.unsubscribe()
		subscriptions.clear()
	}
})
