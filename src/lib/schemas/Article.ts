import { z } from "zod"

//From https://stackoverflow.com/questions/3962543/how-can-i-validate-a-culture-code-with-a-regular-expression
const isLangTag = /[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*|^$/

//From https://stackoverflow.com/questions/25201083/regex-to-match-and-validate-internet-media-type#answer-48046041regex allow
const isMimeType = /(application|audio|font|example|image|message|model|multipart|text|video|x-(?:[0-9A-Za-z!#$%&'*+.^_`|~-]+))\/([0-9A-Za-z!#$%&'*+.^_`|~-]+)((?:[ \t]*;[ \t]*[0-9A-Za-z!#$%&'*+.^_`|~-]+=(?:[0-9A-Za-z!#$%&'*+.^_`|~-]+|\"(?:[^\"\\\\]|\\.)*\"))*)|^$/

const isNumberString = /\d+|^$/

const Article = z.object({
  author: z.string().default(''),
  dateAdded: z.string().datetime().default(new Date().toDateString()),
  dateModified: z.string().datetime({ offset: true }).default(''),
  datePublished: z.string().datetime({ offset: true }).default(''),
  description: z.string().default(''),
  image: z.object({
    url: z.string().url(),
    width: z.string().regex(isNumberString).default(''),
    height: z.string().regex(isNumberString).default(''),
    type: z.string().regex(isMimeType).default('')
  }).optional(),
  locale: z.string().regex(isLangTag).default(''),
  url: z.string().url().default(''),
  siteName: z.string().default(''),
  type: z.string().default(''),
  video: z.string().url().default(''),
  // My stuff
  mimeType: z.string().regex(isMimeType).default(''),
  isRead: z.boolean().default(false),
  isArchived: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  wordCount: z.number().optional(),
  fileName: z.string().default(''),
  readPercentage: z.number().default(0),
  _rawBody:  z.string().default('')
})

export default Article

export type Article = z.infer<typeof Article>
