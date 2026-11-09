import type { RequestHandler } from './$types'
import { jazz } from '../../../lib/server/jazz.js'
// next() is Jazz's public fetch handler with the Vercel WebSocket upgrade path.
const handlers = jazz.next()
export const GET: RequestHandler = ({ request }) => handlers.GET(request)
export const POST: RequestHandler = ({ request }) => handlers.POST(request)
export const DELETE: RequestHandler = ({ request }) => handlers.DELETE(request)
