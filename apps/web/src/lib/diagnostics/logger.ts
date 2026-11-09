import { consoleSink } from './console-sink.js'
import { createLogger as createSharedLogger } from 'delightful-local-first/diagnostics/logger'
export type { Logger, DebugValue } from 'delightful-local-first/diagnostics/logger'

// Clipper chooses the explicit policy; DLF owns the shared output implementation.
export const debugEnabled = import.meta.env.PUBLIC_DEBUG === 'true'
export function createLogger(scope: string) {
	return createSharedLogger(scope, { enabled: debugEnabled, sink: consoleSink })
}
