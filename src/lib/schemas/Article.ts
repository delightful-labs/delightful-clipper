import { z } from 'zod'

//From https://stackoverflow.com/questions/3962543/how-can-i-validate-a-culture-code-with-a-regular-expression
const isLangTag = /[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*/

//From https://stackoverflow.com/questions/25201083/regex-to-match-and-validate-internet-media-type#answer-48046041regex allow
const isMimeType = /(application|audio|font|example|image|message|model|multipart|text|video|x-(?:[0-9A-Za-z!#$%&'*+.^_`|~-]+))\/([0-9A-Za-z!#$%&'*+.^_`|~-]+)((?:[ \t]*;[ \t]*[0-9A-Za-z!#$%&'*+.^_`|~-]+=(?:[0-9A-Za-z!#$%&'*+.^_`|~-]+|\"(?:[^\"\\\\]|\\.)*\"))*)/

const emptyString = z.literal('').default('')

const Article = z.object({
  author: z.string().default(''),
  dateAdded: z.string().datetime().or(emptyString), // @TODO: Might remove the option here for empty string...
  dateModified: z.string().datetime({ offset: true }).or(emptyString),
  datePublished: z.string().datetime({ offset: true }).or(emptyString),
  description: z.string().default(''),
  fileName: z.string().default(''), // @TODO: Probably change to file path?
  id: z.string().uuid().or(emptyString),
  image: z.string().default(''), //@TODO: What about when saving this to WNFS?? Will be a file path, then.
  imageAlt: z.string().default(''),
  isRead: z.boolean().default(false),
  isArchived: z.boolean().default(false),
  locale: z.string().regex(isLangTag).or(emptyString),
  mimeType: z.string().regex(isMimeType).or(emptyString),
  readPercentage: z.number().default(0),
  siteName: z.string().default(''),
  title: z.string().default(''),
  tags: z.array(z.string()).default([]),
  type: z.string().default(''),
  url: z.string().url().trim().or(emptyString),
  //video: z.string().url().or(emptyString), @TODO: figue out structure of this. Might be object like image.
  wordCount: z.number().default(0),
})

export default Article

export type Article = z.infer<typeof Article>
