/// <reference lib="webworker" />
import { createActor, toPromise } from 'xstate'
import { z } from 'zod'
import { imageProcessingMachine } from './process-machine.js'
import { IMAGE_INPUT_LIMIT } from './schema.js'
const input = z.object({
	bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= IMAGE_INPUT_LIMIT),
	mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
})
self.onmessage = (event: MessageEvent<unknown>) => {
	const parsed = input.safeParse(event.data)
	if (!parsed.success) {
		self.postMessage({ kind: 'failed' as const })
		return
	}
	const actor = createActor(imageProcessingMachine, { input: parsed.data }).start()
	void toPromise(actor).then(
		(result) =>
			self.postMessage(result ? { kind: 'ready' as const, result } : { kind: 'failed' as const }),
		() => self.postMessage({ kind: 'failed' as const })
	)
}
