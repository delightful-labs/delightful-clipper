import { z } from 'zod'
import { sourceUrlSchema, connectMessageSchema } from './protocol.js'
export const connectionKey = 'clipper.connection'
export const connectionSchema = connectMessageSchema
	.pick({ accountId: true, requestId: true })
	.extend({
		version: z.literal(1),
		confirmationId: z.uuid(),
		appId: z.uuid(),
		serverUrl: sourceUrlSchema
	})
export type Connection = z.infer<typeof connectionSchema>
export type ConnectionScope = Pick<Connection, 'appId' | 'serverUrl'>
export function connectionFor(value: unknown, scope: ConnectionScope): Connection | undefined {
	const parsed = connectionSchema.safeParse(value)
	if (!parsed.success) return undefined
	if (parsed.data.appId !== scope.appId || parsed.data.serverUrl !== scope.serverUrl)
		return undefined
	return parsed.data
}
export function newlyConfirmedConnection(
	connection: Connection | undefined,
	previous: Connection | undefined,
	requestId: string
) {
	return (
		!!connection &&
		connection.confirmationId !== previous?.confirmationId &&
		connection.requestId === requestId
	)
}
export const authorizationSchema = z.strictObject({
	status: z.enum(['connected', 'signed-out', 'unavailable'])
})
export type Authorization = z.infer<typeof authorizationSchema>['status']
