import { z } from 'zod'
import { accountInput } from '../../src/lib/backend/jazz/account.js'
import { serveApplicationWorker } from '../../src/lib/runtime/worker/serve-application.js'

const stopCommand = z.object({ type: z.literal('FORCE_STOP_HOST') })

// Only this fixture can disrupt the root. The application adapter and native
// storage/broker protocols remain the production implementations.
serveApplicationWorker({
	account: accountInput,
	attach: (host) => {
		// WorkerHost deliberately exposes only the command protocol. Reach the
		// native root's stop method solely to inject this unsupported disruption.
		const stopRoot: unknown = Reflect.get(host, 'stop')
		if (typeof stopRoot !== 'function') throw new Error('Fixture root unavailable')
		const stop = ({ data }: MessageEvent<unknown>) => {
			if (stopCommand.safeParse(data).success) stopRoot.call(host)
		}
		self.addEventListener('message', stop)
		return {
			publish: () => {},
			close: () => self.removeEventListener('message', stop)
		}
	}
})
