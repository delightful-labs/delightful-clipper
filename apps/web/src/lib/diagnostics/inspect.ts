import { createLogger, debugEnabled } from './logger.js'
import { createMachineObserver } from './machines.js'
export const inspectMachines = createMachineObserver(createLogger('clipper:machines'), debugEnabled)
