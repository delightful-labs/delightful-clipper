/** Ready-to-render workflow feedback; presentation never translates machine status codes. */
export type WorkflowMessage = { text: string; variant: 'info' | 'error' }

/** A readable state name is its localized workflow message. Channels separate parallel regions. */
export type NamedState = {
	name?: string
	variant?: WorkflowMessage['variant']
	channel?: string
	priority?: number
}
export function stateFeedback(
	states: Iterable<NamedState | undefined>,
	channel?: string
): WorkflowMessage | undefined {
	const state = [...states]
		.filter((state) => state?.name !== undefined && state.channel === channel)
		.sort((a, b) => (b?.priority ?? 0) - (a?.priority ?? 0))[0]
	return state?.name === undefined
		? undefined
		: { text: state.name, variant: state.variant ?? 'info' }
}
