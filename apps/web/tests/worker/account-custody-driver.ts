import { z } from 'zod'
import { serveScopedAccountStorage } from '../../src/lib/runtime/worker/scoped-storage-channel.js'
import { hostEnvelopeSchema } from '../../src/lib/runtime/worker/host-close-channel.js'

async function bounded<Value>(promise: Promise<Value>) {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Account custody fixture timed out')), 5000)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}
const identity = hostEnvelopeSchema.pick({ scope: true, requestId: true })
const unknownWrite = z.object({
	operationId: z.uuid(),
	scope: z.uuid(),
	writeOutcome: z.literal('unknown'),
	windowPresent: z.literal(false)
})
const result = z.object({
	cleanOwnerClose: z.boolean(),
	firstTransforms: z.number(),
	secondTransforms: z.number()
})
export async function qualifyAccountCustody(forced: boolean) {
	const key = `clipper-account-custody:${crypto.randomUUID()}`,
		scope = crypto.randomUUID()
	const data = new MessageChannel(),
		control = new MessageChannel()
	const worker = new Worker(new URL('./account-custody.worker.ts', import.meta.url), {
		type: 'module'
	})
	const failure = Promise.withResolvers<z.infer<typeof unknownWrite>>(),
		receipt = Promise.withResolvers<z.infer<typeof identity>>()
	const overdue = Promise.withResolvers<void>(),
		finished = Promise.withResolvers<z.infer<typeof result>>()
	const observed = new Map<string, ReturnType<typeof Promise.withResolvers<boolean>>>()
	let writes = 0,
		probeEntered = false
	const abort = new AbortController()
	let probe: Promise<void> | undefined
	const release = serveScopedAccountStorage(
		data.port1,
		control.port1,
		scope,
		{
			getItem: (name) => localStorage.getItem(name),
			setItem: (name, value) => {
				localStorage.setItem(name, value)
				writes++
				worker.postMessage({ type: 'INTERRUPT' })
			}
		},
		key
	)
	const postData = data.port1.postMessage.bind(data.port1)
	data.port1.postMessage = (message: unknown) => {
		if (
			typeof message === 'object' &&
			message !== null &&
			'sequence' in message &&
			message.sequence === 2
		)
			return
		postData(message)
	}
	const postControl = control.port1.postMessage.bind(control.port1)
	control.port1.postMessage = (message: unknown) => receipt.resolve(identity.parse(message))
	const fatal = (error: Error) => {
		failure.reject(error)
		receipt.reject(error)
		overdue.reject(error)
		finished.reject(error)
	}
	// Attach all failure observations before any Worker work can start.
	void failure.promise.catch(() => {})
	void receipt.promise.catch(() => {})
	void overdue.promise.catch(() => {})
	void finished.promise.catch(() => {})
	worker.onerror = () => fatal(new Error('Account custody worker failed'))
	worker.onmessage = ({ data }: MessageEvent<unknown>) => {
		const type = z.object({ type: z.string() }).parse(data).type
		if (type === 'WRITE_UNKNOWN') failure.resolve(unknownWrite.parse(data))
		else if (type === 'OVERDUE') {
			const counters = z
				.object({ firstTransforms: z.literal(1), secondTransforms: z.literal(0) })
				.safeParse(data)
			if (!counters.success) fatal(new Error('Account transform repeated before closure'))
			else overdue.resolve()
		} else if (type === 'CONTROL_PROCESSED') {
			const decoded = identity.extend({ closedSeen: z.boolean() }).parse(data)
			observed.get(decoded.requestId)?.resolve(decoded.closedSeen)
		} else if (type === 'FINISHED') finished.resolve(result.parse(data))
		else fatal(new Error('Unexpected account custody outcome'))
	}
	try {
		worker.postMessage(
			{ type: 'INIT', data: data.port2, control: control.port2, scope, key, forced },
			[data.port2, control.port2]
		)
		const [failed, close] = await bounded(Promise.all([failure.promise, receipt.promise]))
		probe = navigator.locks.request(key, { signal: abort.signal }, () => {
			probeEntered = true
		})
		void probe.catch(() => {})
		worker.postMessage({ type: 'OVERDUE' })
		await bounded(overdue.promise)
		const locked = await navigator.locks.query()
		const heldBeforeReceipt = locked.held?.filter((lock) => lock.name === key).length ?? 0
		if (heldBeforeReceipt !== 1 || probeEntered)
			throw new Error('Account lease released before closure')
		const wrongId = crypto.randomUUID(),
			seenWrong = Promise.withResolvers<boolean>()
		observed.set(wrongId, seenWrong)
		postControl({ version: 1, type: 'HOST_CLOSED', scope, requestId: wrongId })
		if (await bounded(seenWrong.promise))
			throw new Error('Old close identity released account custody')
		postControl({ ...close, version: 1, type: 'HOST_CLOSED' })
		await bounded(probe)
		worker.postMessage({ type: 'FINISH' })
		const done = await bounded(finished.promise)
		return {
			...done,
			writeOutcome: failed.writeOutcome,
			workerOnly: !failed.windowPresent,
			matchingScope: failed.scope === scope,
			heldBeforeReceipt,
			writes,
			persisted: localStorage.getItem(key),
			probeEntered
		}
	} finally {
		abort.abort()
		release()
		worker.terminate()
		localStorage.removeItem(key)
	}
}
