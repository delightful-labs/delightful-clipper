import type { InspectionEvent } from 'xstate'
import type { Logger, DebugValue } from 'delightful-local-first/diagnostics/logger'

function field(value: unknown, key: string): unknown {
	if (!value || typeof value !== 'object') return undefined
	return Object.getOwnPropertyDescriptor(value, key)?.value
}
function identifier(value: unknown): string | undefined {
	return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value)
		? value.replace(/[A-Za-z0-9_]{28,}/g, '[identifier redacted]')
		: undefined
}
/** Technical diagnostics only; exclude embedded credentials, queries and source content. */
export function diagnosticText(text: string) {
	return text
		.slice(0, 4000)
		.replace(/\{[\s\S]*\}|\[[\s\S]*\]/g, '[payload redacted]')
		.replace(/(["'`])[^\n]*?\1/g, '[value redacted]')
		.replace(/\b[a-z][a-z+.-]*:\/\/[^\s)]+/gi, '[URL redacted]')
		.replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[authorization redacted]')
		.replace(
			/\b(?:secret|token|password|authorization|cookie|phrase|jwt|nonce)\s*[:=]\s*[^\s,;]+/gi,
			'[value redacted]'
		)
		.replace(/\b[A-Za-z0-9_+/=.-]{28,}\b/g, '[token redacted]')
		.replace(
			/\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b[\s\S]*/gi,
			'[query redacted]'
		)
		.replace(/\b(?:[a-z]{2,12}\s+){11,23}[a-z]{2,12}\b/g, '[text redacted]')
		.replace(/(?:\/Users|\/home)\/[^\s)]*/g, '[path redacted]')
		.slice(0, 1000)
}
function diagnosticError(error: unknown, depth = 0): DebugValue {
	if (error === undefined || error === null) return undefined
	if (typeof error === 'string') return { message: diagnosticText(error) }
	if (typeof error !== 'object' || depth >= 3) return { truncated: true }
	const name = field(error, 'name') ?? field(Object.getPrototypeOf(error), 'name')
	const message = field(error, 'message')
	return {
		name: identifier(name) ?? 'Error',
		message: typeof message === 'string' ? diagnosticText(message) : undefined,
		code: identifier(field(error, 'code')),
		cause: diagnosticError(field(error, 'cause'), depth + 1)
	}
}
function statePaths(value: unknown, prefix = '', depth = 0): string[] {
	if (depth > 12) return []
	if (typeof value === 'string') return identifier(value) ? [prefix + value] : []
	if (!value || typeof value !== 'object') return []
	return Object.keys(value)
		.slice(0, 16)
		.flatMap((key) =>
			identifier(key) ? statePaths(field(value, key), prefix + key + '.', depth + 1) : []
		)
}
/** One observer per actor tree. Never serialize actor input, context, event payloads or SDK handles. */
export function createMachineObserver(logger: Logger, enabled: boolean) {
	const previous = new WeakMap<object, string>()
	return (event: InspectionEvent) => {
		if (!enabled || (event.type !== '@xstate.snapshot' && event.type !== '@xstate.event')) return
		try {
			const actor = event.actorRef
			const snapshot: unknown =
				event.type === '@xstate.snapshot' ? event.snapshot : actor.getSnapshot()
			const machine = identifier(field(field(field(actor, 'logic'), 'config'), 'id'))
			const errorEvent = event.event.type.startsWith('xstate.error.actor.')
			const error =
				field(snapshot, 'error') ?? (errorEvent ? field(event.event, 'error') : undefined)
			// Promise actors have no modeled machine id; report only their errors.
			if (!machine && error === undefined) return
			const states = statePaths(field(snapshot, 'value'))
			const status = identifier(field(snapshot, 'status'))
			const output = field(snapshot, 'output')
			const outcome = identifier(field(output, 'outcome') ?? field(output, 'kind'))
			const failed =
				status === 'error' ||
				errorEvent ||
				states.some((s) => /failed|failure|error|rejected|unknown/i.test(s)) ||
				!!outcome?.match(/failed|rejected|unknown|unavailable/i)
			const details = {
				machine: machine ?? 'invoked-actor',
				status,
				states,
				outcome,
				error: diagnosticError(error)
			}
			const fingerprint = JSON.stringify(details)
			if (previous.get(actor) === fingerprint) return
			previous.set(actor, fingerprint)
			if (failed) logger.error('Machine failure', details)
			else logger.info('Machine state', details)
		} catch {
			logger.warn('Machine diagnostics unavailable')
		}
	}
}
