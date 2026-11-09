import { createActor } from 'xstate'
import { createSearchWorkerMachine } from './worker-machine.js'
import { readSearchCache, writeSearchCache } from './cache.js'
import { searchWorkerInputSchema } from './protocol.js'
const actor = createActor(
	createSearchWorkerMachine({
		read: readSearchCache,
		write: writeSearchCache,
		report: (message) => postMessage(message)
	})
).start()
onmessage = (event: MessageEvent<unknown>) => {
	const parsed = searchWorkerInputSchema.safeParse(event.data)
	if (parsed.success) actor.send(parsed.data)
	else postMessage({ type: 'WORKER_ERROR' as const })
}
