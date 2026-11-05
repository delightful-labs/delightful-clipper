import type { LibraryFactory } from '../../web/src/lib/backend/jazz/account.js'
/** The web app owns URL fetching; a trusted extension clip supplies its already-rendered content. */
export const extensionLibrary: LibraryFactory = (records) => ({
	libraryId: records.articles.libraryId,
	isCurrent: records.isCurrent,
	read: records.readCapabilities,
	subscribe: records.articles.subscribe,
	spawnSave: (spawn, input) => spawn(records.articles.saveMachine, { input }),
	worker: (report) => ({
		send: (event) => {
			if (event.type === 'STOP') report({ type: 'BACKGROUND_CLOSED' })
		},
		stop: async () => {}
	})
})
