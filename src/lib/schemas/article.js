import { z } from "zod"

//From https://stackoverflow.com/questions/3962543/how-can-i-validate-a-culture-code-with-a-regular-expression
const isLangTag = /[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*|^$/

//From https://stackoverflow.com/questions/25201083/regex-to-match-and-validate-internet-media-type#answer-48046041regex allow
const isMimeType = /(application|audio|font|example|image|message|model|multipart|text|video|x-(?:[0-9A-Za-z!#$%&'*+.^_`|~-]+))\/([0-9A-Za-z!#$%&'*+.^_`|~-]+)((?:[ \t]*;[ \t]*[0-9A-Za-z!#$%&'*+.^_`|~-]+=(?:[0-9A-Za-z!#$%&'*+.^_`|~-]+|\"(?:[^\"\\\\]|\\.)*\"))*)|^$/

const Article = z.object({
    author: z.string().default(''),
    datePublished: z.date().optional(),
    dateModified: z.date().optional(),
    description: z.string().default(''),
    image: {},
    locale: z.string().regex(isLangTag).default(''),
    url: z.string().url().default(''),
    //Possibles
    siteName: '',
    type: '',
    video: '',
    // My stuff
    mimeType: z.string().regex(isMimeType).default(''),
    isRead: z.boolean().default(false),
    isArchived: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    //@TODO: Add date
    dateAdded: z.date().optional(),
    wordCount: z.number().optional(),
    fileName: z.string().default(''),
    readPercentage: {}, //??
    _rawBody:  z.string().default('')
})
