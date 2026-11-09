import { jazz } from '../../../lib/server/jazz.js'
import type { RequestHandler } from './$types'

const handlers = jazz.next()
export const GET: RequestHandler = ({ request }) => handlers.GET(request)
export const POST: RequestHandler = ({ request }) => handlers.POST(request)
export const DELETE: RequestHandler = ({ request }) => handlers.DELETE(request)
