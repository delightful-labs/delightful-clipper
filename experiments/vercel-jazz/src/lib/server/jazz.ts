import { acceptLocalFirstAuth, createJazz, vercel } from 'jazz-tools/backend'
import { app, permissions } from '../model.js'
// Jazz owns lazy acquisition, schema publication, connections, and shutdown.
// Let Jazz derive separate project/branch names; no production app IDs or secrets.
export const jazz = createJazz({
	app,
	permissions,
	authenticate: acceptLocalFirstAuth,
	store: vercel({ vcpus: 1, maxDriveBytes: 1024 ** 3, blobs: 'sqlite', idleMs: 60_000 })
})
