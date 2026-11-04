import { it, expect, vi } from 'vitest'
import { createLogger } from 'delightful-local-first/diagnostics/logger'
import { consoleSink } from './console-sink.js'
it('retains nested machine errors and states in a single exportable console line', () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		createLogger('clipper:machines', { enabled: true, sink: consoleSink }).error(
			'Machine failure',
			{
				machine: 'root-bootstrap',
				states: ['reading'],
				error: {
					code: 'protocol',
					message: 'durable catalogue must have exactly one genesis schema'
				}
			}
		)
		expect(log).toHaveBeenCalledExactlyOnceWith(
			'[clipper:machines] Machine failure {"machine":"root-bootstrap","states":["reading"],"error":{"code":"protocol","message":"durable catalogue must have exactly one genesis schema"}}'
		)
	} finally {
		log.mockRestore()
	}
})
it('does not format or emit diagnostics when logging is disabled', () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		createLogger('clipper:machines', { enabled: false, sink: consoleSink }).error('Hidden', {
			machine: 'root-bootstrap'
		})
		expect(log).not.toHaveBeenCalled()
	} finally {
		log.mockRestore()
	}
})
