import { assign, fromPromise, setup } from 'xstate'
import type { Candidate } from '../../capture/source.js'
import type { CapturePreparation, LibraryCapability } from '../../contracts/library.js'
type Input = { capability: LibraryCapability; url: string }
type Context = Input & {
	requestId: string
	destination: string
	id: string
	candidate: Omit<Candidate, 'id'> | undefined
	result: CapturePreparation | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Incomplete preparation')
	return value
}
function current(context: Context, signal: AbortSignal) {
	signal.throwIfAborted()
	if (!context.capability.isCurrent()) throw new Error('scopeChanged')
}
const actors = {
	resolve: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => {
		current(input, signal)
		return input.capability.resolve(input.url, input.requestId, signal)
	}),
	identify: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => {
		current(input, signal)
		return input.capability.identify(input.destination, signal)
	}),
	document: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => {
		current(input, signal)
		return input.capability.hasDocument(input.id, signal)
	}),
	intent: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => {
		current(input, signal)
		return input.capability.hasIntent(input.id, signal)
	}),
	extract: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) => {
		current(input, signal)
		return input.capability.extract(input.url, input.requestId, signal)
	})
}
const model = setup<
	Context,
	{ type: 'CANCEL' },
	typeof actors,
	{},
	{},
	{ scopeLost: undefined },
	never,
	string,
	Input,
	CapturePreparation
>({ actors, guards: { scopeLost: ({ context }) => !context.capability.isCurrent() } })
const input = ({ context }: { context: Context }) => context
/** Each await/branch is observable; stopping the actor aborts its current read/network leaf. */
export const preparationMachine = model.createMachine({
	id: 'capture-preparation',
	initial: 'resolving',
	context: ({ input }) => ({
		...input,
		requestId: crypto.randomUUID(),
		destination: '',
		id: '',
		candidate: undefined,
		result: undefined
	}),
	output: ({ context }) => required(context.result),
	states: {
		resolving: {
			invoke: {
				src: 'resolve',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'scopeChanged' },
					{
						target: 'identifyingResolved',
						actions: assign({ destination: ({ event }) => event.output })
					}
				]
			}
		},
		identifyingResolved: {
			invoke: {
				src: 'identify',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'scopeChanged' },
					{
						target: 'checkingResolvedDocument',
						actions: assign({ id: ({ event }) => event.output })
					}
				]
			}
		},
		checkingResolvedDocument: {
			invoke: {
				src: 'document',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'scopeChanged' },
					{ guard: ({ event }) => event.output, target: 'duplicate' },
					{ target: 'checkingResolvedIntent' }
				]
			}
		},
		checkingResolvedIntent: {
			invoke: {
				src: 'intent',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'scopeChanged' },
					{ guard: ({ event }) => event.output, target: 'uncertain' },
					{ target: 'extracting' }
				]
			}
		},
		extracting: {
			invoke: {
				src: 'extract',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'scopeChanged' },
					{
						target: 'identifyingExtracted',
						actions: assign({
							candidate: ({ event }) => event.output,
							destination: ({ event }) => event.output.finalUrl
						})
					}
				]
			}
		},
		identifyingExtracted: {
			invoke: {
				src: 'identify',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'scopeChanged' },
					{
						target: 'checkingExtractedDocument',
						actions: assign({ id: ({ event }) => event.output })
					}
				]
			}
		},
		checkingExtractedDocument: {
			invoke: {
				src: 'document',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'scopeChanged' },
					{ guard: ({ event }) => event.output, target: 'duplicate' },
					{ target: 'checkingExtractedIntent' }
				]
			}
		},
		checkingExtractedIntent: {
			invoke: {
				src: 'intent',
				input,
				onDone: [
					{ guard: 'scopeLost', target: 'scopeChanged' },
					{ guard: ({ event }) => event.output, target: 'uncertain' },
					{ target: 'ready' }
				]
			}
		},
		scopeChanged: {
			type: 'final',
			entry: assign({ candidate: undefined, result: { kind: 'scopeChanged' } })
		},
		duplicate: {
			entry: assign({
				result: ({ context }) => ({ kind: 'duplicate', id: context.id }),
				candidate: undefined
			}),
			type: 'final'
		},
		uncertain: {
			entry: assign({
				result: ({ context }) => ({ kind: 'uncertain', id: context.id }),
				candidate: undefined
			}),
			type: 'final'
		},
		ready: {
			entry: assign({
				result: ({ context }) => ({
					kind: 'ready',
					candidate: { ...required(context.candidate), id: context.id }
				}),
				candidate: undefined
			}),
			type: 'final'
		}
	}
})
