import { CAPTURE_GATEWAY_ENABLED } from '$app/env/public'
import type { RequestHandler } from './$types'
import { capture } from '../../../../lib/server/capture/handler.js'
export const POST: RequestHandler = ({ request, locals }) =>
	capture(request, locals.gatewayAccountId, 'extract', CAPTURE_GATEWAY_ENABLED)
