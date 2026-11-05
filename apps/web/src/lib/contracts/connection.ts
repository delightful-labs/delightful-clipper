export type ConnectionEvent = { type: 'ONLINE' | 'OFFLINE' }
export type ConnectionObserver = (report: (event: ConnectionEvent) => void) => () => void
