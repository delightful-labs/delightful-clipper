import { z } from 'zod'
import { organizationRequestSchema, libraryViews } from '../../capture/organization.js'
import { uuidSchema } from '../../validation/values.js'
import { readerChangeSchema } from '../../reader/schema.js'
function identified<T extends string>(type: T) {
	return z.object({ type: z.literal(type), id: uuidSchema })
}
function simple<T extends string>(type: T) {
	return z.object({ type: z.literal(type) })
}
export const libraryIntentSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('ADD'), url: z.string().max(8192) }),
	identified('OPEN'),
	identified('RETRY'),
	identified('RETRY_IMAGE'),
	z.object({ type: z.literal('IMAGE_ERROR'), id: z.string().max(8192), url: z.string().max(8192) }),
	simple('CANCEL'),
	simple('CLOSE_READER'),
	simple('SEARCH_OPEN'),
	simple('RETRY_SEARCH'),
	z.object({ type: z.literal('QUERY'), query: z.string().max(8192) }),
	z.object({ type: z.literal('FILTER'), view: z.enum(libraryViews), favorites: z.boolean() }),
	z.object({ type: z.literal('TAG_FILTER'), keys: z.array(z.string().max(512)).max(64) }),
	z.object({ type: z.literal('ORGANIZE'), request: organizationRequestSchema }),
	z.object({
		type: z.literal('READER_EVENT'),
		event: z.discriminatedUnion('type', [
			z.object({ type: z.literal('CHANGE'), change: readerChangeSchema }),
			z.object({ type: z.enum(['REFLOW', 'DETACH', 'FOCUS', 'SHOW_CONTROLS']) })
		])
	})
])
export type LibraryIntent = z.infer<typeof libraryIntentSchema>
export const commandSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('SHUTDOWN') }),
	z.object({ type: z.literal('CONNECTIVITY'), online: z.boolean() }),
	z.object({
		type: z.literal('RECOVERY'),
		scope: z.string().uuid(),
		event: z.discriminatedUnion('type', [simple('REVEAL'), simple('RETRY'), simple('HIDE')])
	}),
	z.object({
		type: z.literal('ACCOUNT'),
		scope: z.string().uuid(),
		event: z.discriminatedUnion('type', [
			z.object({ type: z.enum(['CREATE', 'LOGOUT', 'RETRY']) }),
			z.object({ type: z.literal('RESTORE'), phrase: z.string().max(4096) })
		])
	}),
	z.object({
		type: z.literal('LIBRARY'),
		scope: z.string().uuid(),
		requestId: z.string().uuid(),
		event: libraryIntentSchema
	}),
	z.object({ type: z.literal('MORE'), scope: z.string().uuid() }),
	z.object({ type: z.literal('TAG_EDIT'), scope: z.string().uuid(), id: uuidSchema.optional() }),
	z.object({
		type: z.literal('ATTACH'),
		scope: z.string().uuid(),
		documentId: z.string().uuid(),
		images: z.array(z.string().max(24 * 1024)).max(250),
		port: z.instanceof(MessagePort),
		fullscreen: z.object({ supported: z.boolean(), active: z.boolean() })
	}),
	z.object({
		type: z.literal('TAG_FORM'),
		requestId: z.string().uuid(),
		scope: z.string().uuid(),
		event: z.discriminatedUnion('type', [
			z.object({ type: z.literal('RESET') }),
			z.object({
				type: z.literal('SELECT'),
				id: z.string().uuid(),
				names: z.array(z.string().max(256)).max(65)
			})
		])
	})
])
export type RuntimeCommand = z.infer<typeof commandSchema>
