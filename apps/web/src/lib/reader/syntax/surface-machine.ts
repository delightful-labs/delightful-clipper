import { createActor, createCallbackLogic, setup, types } from 'xstate'
import {
	codeElements,
	installSyntaxRanges,
	supportsSyntaxHighlights,
	type CodeElement
} from './native.js'
import { rangesMatchBlocks, syntaxReplySchema, type CodeBlock, type SyntaxRange } from './schema.js'

type Event =
	| { type: 'CREATED' | 'POSTED' }
	| { type: 'RANGES'; ranges: SyntaxRange[] }
	| { type: 'FAILED' }
export type SyntaxWorker = {
	postMessage: (blocks: CodeBlock[]) => void
	terminate: () => void
	onmessage: ((event: MessageEvent<unknown>) => void) | null
	onerror: ((event: ErrorEvent) => void) | null
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null
}
type Input = { root: HTMLElement; createWorker?: () => SyntaxWorker }
type Context = Input & {
	elements: CodeElement[]
	supported: boolean
	ranges: SyntaxRange[]
}

const workerLease = createCallbackLogic<{ type: 'POST'; blocks: CodeBlock[] }, Input>(
	({ input, sendBack, receive }) => {
		let worker: SyntaxWorker | undefined
		try {
			worker =
				input.createWorker?.() ??
				new Worker(new URL('./tokenize.worker.ts', import.meta.url), { type: 'module' })
			worker.onmessage = ({ data }: MessageEvent<unknown>) => {
				const parsed = syntaxReplySchema.safeParse(data)
				if (!parsed.success || parsed.data.kind === 'failed') sendBack({ type: 'FAILED' })
				else sendBack({ type: 'RANGES', ranges: parsed.data.ranges })
			}
			worker.onerror = () => sendBack({ type: 'FAILED' })
			worker.onmessageerror = () => sendBack({ type: 'FAILED' })
			receive(({ blocks }) => {
				try {
					worker!.postMessage(blocks)
					sendBack({ type: 'POSTED' })
				} catch {
					sendBack({ type: 'FAILED' })
				}
			})
			// Register the disposal lease before the parent can issue POST.
			queueMicrotask(() => sendBack({ type: 'CREATED' }))
		} catch {
			worker?.terminate()
			sendBack({ type: 'FAILED' })
			return
		}
		return () => {
			worker.onmessage = null
			worker.onerror = null
			worker.onmessageerror = null
			worker.terminate()
		}
	}
)
const rangesLease = createCallbackLogic<Event, Pick<Context, 'elements' | 'ranges'>>(
	({ input, sendBack }) => {
		try {
			return installSyntaxRanges(input.elements, input.ranges)
		} catch {
			sendBack({ type: 'FAILED' })
		}
	}
)

export const syntaxSurfaceMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<Context>(),
		events: {
			CREATED: types<{}>(),
			POSTED: types<{}>(),
			RANGES: types<{ ranges: SyntaxRange[] }>(),
			FAILED: types<{}>()
		},
		children: {
			worker: types<import('xstate').ActorRefFrom<typeof workerLease>>(),
			ranges: types<import('xstate').ActorRefFrom<typeof rangesLease>>()
		}
	},
	actors: { worker: workerLease, ranges: rangesLease },
	guards: {
		canHighlight: ({ context }: { context: Context }) =>
			context.supported && context.elements.length > 0,
		matchingRanges: ({ context }: { context: Context }, { ranges }: { ranges: SyntaxRange[] }) =>
			rangesMatchBlocks(
				ranges,
				context.elements.map((element) => element.block)
			)
	}
}).createMachine({
	id: 'reader-syntax',
	context: ({ input }) => input,
	initial: 'checking',
	states: {
		checking: {
			type: 'choice',
			choice: (args) =>
				args.guards.canHighlight(args) ? { target: 'tokenizing' } : { target: 'plain' }
		},
		tokenizing: {
			initial: 'creating',
			invoke: { id: 'worker', src: 'worker', input: ({ context }) => context },
			after: { 5000: { target: 'plain' } },
			on: {
				FAILED: { target: 'plain' },
				RANGES: (args) => {
					if (args.guards.matchingRanges(args, { ranges: args.event.ranges }))
						return {
							target: 'highlighted',
							context: { ranges: args.event.ranges }
						}
					return { target: 'plain' }
				}
			},
			states: {
				creating: {
					on: { CREATED: { target: 'posting' } }
				},
				posting: {
					entry: ({ context }, enq) =>
						enq.sendTo('worker', {
							type: 'POST',
							blocks: context.elements.map((element) => element.block)
						}),
					on: { POSTED: { target: 'waiting' } }
				},
				waiting: {}
			}
		},
		highlighted: {
			invoke: { id: 'ranges', src: 'ranges', input: ({ context }) => context },
			on: { FAILED: { target: 'plain' } }
		},
		plain: { type: 'final' }
	}
})

/** UI mount boundary: owns the worker and every registered native range until
 * saved content is replaced or its reader leaves. Colors never change the DOM.
 */
export function highlightCode(root: HTMLElement) {
	const actor = createActor(syntaxSurfaceMachine, {
		input: {
			root,
			elements: codeElements(root),
			supported: supportsSyntaxHighlights(root),
			ranges: []
		}
	})
	actor.subscribe({ error: () => actor.stop() })
	actor.start()
	return () => actor.stop()
}
