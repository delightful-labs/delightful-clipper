import { accountInput } from '../../web/src/lib/backend/jazz/account.js'
import { serveExtensionAccount } from './account-worker.js'
serveExtensionAccount({ account: accountInput, connected: () => {}, closed: () => {} })
