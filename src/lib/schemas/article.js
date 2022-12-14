import { z } from "zod"

const Article = z.object({
    author: z.string().default(''),
    datePublished: z.date().optional(),
    dateModified: z.date().optional(),
    description: z.string().default(''),
    image: {},
    locale: '',
    url: '',
    //Possibles
    siteName: '',
    type: '',
    video: '',
    // My stuff
    mimeType: '',
    isRead: false,
    isArchived: false,
    tags: [],
    //@TODO: Add date
    dateAdded: '',
    wordCount: 0,
    fileName: '',
    readPercentage: {}, //??
    _rawBody: ''
})