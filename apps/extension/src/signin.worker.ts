import { existingAccountInput } from '../../web/src/lib/backend/jazz/account.js'
import { serveExtensionAccount } from './account-worker.js'
serveExtensionAccount({
	account: existingAccountInput,
	connected: (shutdown) => shutdown(),
	closed: (port) => port.postMessage({ type: 'CLOSE' })
})
