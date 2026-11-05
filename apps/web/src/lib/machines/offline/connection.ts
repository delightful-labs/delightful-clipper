import { fromCallback, setup, type SnapshotFrom } from 'xstate'
import { t } from '../../localization/index.js'
import { stateFeedback } from '../../contracts/feedback.js'

type ConnectionEvent = { type: 'ONLINE' | 'OFFLINE' }
export function createConnectionMachine(
	observe: (report: (event: ConnectionEvent) => void) => () => void
) {
	return setup<{}, ConnectionEvent, { observe: ReturnType<typeof fromCallback<ConnectionEvent>> }>({
		actors: { observe: fromCallback<ConnectionEvent>(({ sendBack }) => observe(sendBack)) }
	}).createMachine({
		id: 'browser-connection',
		initial: 'checking',
		invoke: { src: 'observe' },
		on: { ONLINE: '.online', OFFLINE: '.offline' },
		states: {
			checking: {},
			online: { meta: { name: t('connection.online') } },
			offline: { meta: { name: t('connection.offline') } }
		}
	})
}
export function selectConnectionMessage(
	snapshot: SnapshotFrom<ReturnType<typeof createConnectionMachine>> | undefined
) {
	return snapshot ? stateFeedback(Object.values(snapshot.getMeta())) : undefined
}
