import { accountInput } from '../../backend/jazz/account.js'
import { serveApplicationWorker } from './serve-application.js'
serveApplicationWorker({ account: accountInput })
