import sanitize from 'sanitize-html'
import { Readability } from '@mozilla/readability'
import { DOMParser } from 'linkedom'

/**
 * Takes an array of strings and an object and returns tthe first key found.
 * @param {string[]} arr 
 * @param {*} obj 
 * @returns {string|undefined}
 */
export const getFirstKeyMatch = (arr, obj) => {
  let first
  
  arr.every(string => {
    if (obj[string]) {
      first = obj[string]
      //If key is found, return `false` to exit the loop.
      return false
    }
  })

  return first
}

/**
 * Filters out only the desired meta tags and renames them
 * @param {*} obj
 */
  export const processWebpageMetadata = (obj) => {
  const results = {
    author: getFirstKeyMatch(['articleAuthor', 'author'], obj) || '', //author, articleAuthor, articleTag (used by NYT) / Medium uses articleAuthor as url and author as string of name
    title: obj.ogTitle || '',
    datePublished: getFirstKeyMatch(['articlePublishedTime', 'ogDate'], obj) || '',
    dateModified: obj.articleModifiedTime || '',
    description: obj.ogDescription || '',
    image: obj.ogImage || {},
    locale: obj.ogLocale || '',
    url: getFirstKeyMatch(['requestUrl', 'ogUrl'], obj) || '',
    //Possibles
    siteName: obj.ogSiteName || '',
    type: obj.ogType || '',
    video: obj.ogVideo || '',
    // My stuff
    mimeType: '',
    isRead: false,
    isArchived: false,
    dateAdded: '',
    wordCount: 0,
    fileName: '',
    readPercentage: {}, //??
    _rawBody: ''
  }

  return results
}

/**
 * 
 * @param {string} lang 
 * @param {string} meta 
 * @param {string} title 
 * @param {string} content 
 * @returns {string}
 */
const createHtmlFromTemplate = (lang, meta, title, content) => `
  <!DOCTYPE html>
  <html lang="${lang}">
    <head>
      ${meta}
      <title>${title}</title>
    </head>
    <body>
      ${content}
    </body>
  </html>
`

/**
 * Extracts the main section of the webpage provided.
 * @param {string} webpageText 
 * @param {string} lang
 */
export const extractMainContent = async (webpageText, lang) => {
  const doc = new DOMParser().parseFromString(webpageText, 'text/html')
  const meta = doc.getElementsByTagName('meta')
  const article = new Readability(doc, { serializer: el => el }).parse()
  const allowedTags = sanitize.defaults.allowedTags.concat([ 'img', 'details', 'summary', 'svg' ])
  const clean = article && sanitize(article?.content, { allowedTags: allowedTags})
  //@TODO: add newline after meta.join
  const combined = clean ? createHtmlFromTemplate(lang, meta.join(''), article ? article.title : '', clean) : ''
  return { body: combined,  wordCount: getWordCount(article?.textContent)}
}

/**
 * Gets the numbers of words in a string
 * @param {*} text 
 * @returns {number}
 */
export const getWordCount = (text) => {
  const words = text.trim().split(/\s+/g).length
  return words
}
