import { createLogger, debugEnabled } from './logger.js'
import { createMachineObserver, createRejectedEventObserver } from './machines.js'
const logger = createLogger('clipper:machines')
export const inspectMachines = createMachineObserver(logger, debugEnabled)
export const machineDiagnostics = {
	inspect: inspectMachines,
	onRejectedEvent: createRejectedEventObserver(logger, debugEnabled)
}
