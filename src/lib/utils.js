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
export const processWebpageMetadata = (obj) => ({
  author: getFirstKeyMatch(['articleAuthor', 'author'], obj), //article:author, author, articleTag (used by NYT) / Medium uses articleAuthor as url and author as string of name
  title: obj.ogTitle, //og:title, title, html title
  datePublished: getFirstKeyMatch(['articlePublishedTime', 'ogDate'], obj), //article:published_time
  dateModified: obj.articleModifiedTime, //article:modified_time, og:updated_time
  description: obj.ogDescription, //og:description, description
  image: obj.ogImage, //og:image, image, first image in article
  imageAlt: '', //og:image:alt
  locale: obj.ogLocale, //og:locale, html lang tag
  url: getFirstKeyMatch(['requestUrl', 'ogUrl'], obj), //og:url, url, original url from request
  siteName: obj.ogSiteName, //og:site_name
  type: obj.ogType, //og:type, type, content-type
  video: obj.ogVideo, //og:video (url string)
  videoType: '', //og:video:type
  //copyright??
  //article:content_tier??
  //byl??,
  //theme-color?? Could do some fun design stuff with this
})

/**
 * 
 * @param {string} lang 
 * @param {string} meta 
 * @param {string} title 
 * @param {string} content 
 * @returns {string}
 */
const createHtmlFromTemplate = (lang, meta, title, content) => `<!DOCTYPE html>
  <html lang="${lang}">
    <head>
      ${meta}
      <title>${title}</title>
    </head>
    <body>
      ${content}
    </body>
  </html>`

/**
 * 
 * @param {string} text 
 */
export const prepareHtml = (text) => {
  //const doc = new DOMParser().parseFromString(text, 'text/html')
  const allowedTags = sanitize.defaults.allowedTags.concat([ 'img', 'details', 'summary', 'svg' ])
  const clean = sanitize(text, { allowedTags: allowedTags})
  console.log(clean)
}

/**
 * Extracts the main section of the webpage provided.
 * @param {string} webpageText 
 * @param {string} lang
 */
export const extractMainContent = async (webpageText, lang) => {
  const doc = new DOMParser().parseFromString(webpageText, 'text/html')
  let scrapedMeta = {}
  //Filter out only the meta tags I want (og:, description, charset, author)
  const meta = doc.getElementsByTagName('meta')
  meta.forEach(a => scrapedMeta[a.getAttribute('property') || a.getAttribute('name')] = a.getAttribute('content'))
  console.log(scrapedMeta)
  // const article = new Readability(doc, { serializer: el => el }).parse()
  // const allowedTags = sanitize.defaults.allowedTags.concat([ 'img', 'details', 'summary', 'svg' ])
  // const clean = article && sanitize(article?.content, { allowedTags: allowedTags})
  // const combined = clean ? createHtmlFromTemplate(lang, meta.join('\n'), article ? article.title : '', clean) : ''
  // return { body: combined,  wordCount: getWordCount(article?.textContent)}
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
