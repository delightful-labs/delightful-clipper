import type { LogSink } from 'delightful-local-first/diagnostics/logger'

// Firefox's console export collapses object arguments; retain selected fields as text.
export const consoleSink: LogSink = {
	info: (message, details) => console.info(`${message} ${JSON.stringify(details)}`),
	warn: (message, details) => console.warn(`${message} ${JSON.stringify(details)}`),
	error: (message, details) => console.error(`${message} ${JSON.stringify(details)}`)
}
