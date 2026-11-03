import { defineParams } from '@sveltejs/kit/params'
import { isArticleId } from './lib/reader/routes.ts'
export const params = defineParams({ article: (value) => (isArticleId(value) ? value : undefined) })
