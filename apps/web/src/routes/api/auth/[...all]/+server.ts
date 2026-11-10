import type { RequestHandler } from './$types'
import { handleAuth } from '../../../../lib/server/auth/handler.js'

export const GET: RequestHandler = ({ request }) => handleAuth(request)
export const POST: RequestHandler = ({ request }) => handleAuth(request)
