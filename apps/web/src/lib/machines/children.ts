import type { EnqueueObject, SystemRegistry } from 'xstate'

/** A parent's v6 enqueuer restricted to direct logic, retaining each child's full
 * input, snapshot and sendable-event types across application capability ports. */
export type ChildSpawner = EnqueueObject<never, never, SystemRegistry, {}>['spawn']
