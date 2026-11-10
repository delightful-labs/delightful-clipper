/// <reference lib="webworker" />
import { createActor, createAsyncLogic, toPromise } from 'xstate'
import { createOffsetHighlighter } from './offset-host.js'
import { codeBlocksSchema, syntaxRangesSchema, type CodeBlock } from './schema.js'

const highlight = createOffsetHighlighter()
const tokenize = createAsyncLogic({
	run: async ({ input }: { input: CodeBlock[] }) => syntaxRangesSchema.parse(await highlight(input))
})

self.onmessage = ({ data }: MessageEvent<unknown>) => {
	self.onmessage = null
	const parsed = codeBlocksSchema.safeParse(data)
	if (!parsed.success) {
		self.postMessage({ kind: 'failed' })
		return
	}
	const actor = createActor(tokenize, { input: parsed.data }).start()
	void toPromise(actor).then(
		(ranges) => self.postMessage({ kind: 'ready', ranges }),
		() => self.postMessage({ kind: 'failed' })
	)
}
