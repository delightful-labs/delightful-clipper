import sanitize from 'sanitize-html'
import { Readability } from '@mozilla/readability'
import { DOMParser } from 'linkedom'
import { readJsonConfigFile } from 'typescript'

/**
 * Takes an array of strings and an object and returns tthe first key found.
 * @param {string[]} arr 
 * @param {*} obj 
 * @returns {string|undefined}
 */
export const getFirstKeyMatch = (arr, obj, i = 0) => {
  let first

  for (const string of arr) {
    if(!!obj[string]) {
      first = obj[string]

      break
    }
  }

  return first
}

/**
 * 
 * @param {*} doc 
 */
const extractWebpageMetadata = (doc) => {
  // let scrapedMeta = {}
  //Filter out only the meta tags I want (og:, description, charset, author)
  const meta = doc.getElementsByTagName('meta')

  console.log(meta)
  return meta.reduce((previousValue, currentItem) => {
    console.log(currentItem)
    return {...previousValue, [currentItem.getAttribute('property') || currentItem.getAttribute('name')]: currentItem.getAttribute('content')}
  }, {})
}

/**
 * Filters out only the desired meta tags and renames them
 * @param {*} obj
 */
export const processWebpageMetadata = (obj) => ({
  author: getFirstKeyMatch(['article:author', 'author'], obj), //article:author, author, articleTag (used by NYT) / Medium uses articleAuthor as url and author as string of name
  title: getFirstKeyMatch(['og:title', 'title'], obj), //If not, check html title
  datePublished: getFirstKeyMatch(['article:published_time', 'og:date'], obj),
  dateModified: getFirstKeyMatch(['article:modified_time', 'og:updated_time'], obj),
  description: getFirstKeyMatch(['og:description', 'description'], obj),
  image: getFirstKeyMatch(['og:description', 'description'], obj), //If not, get first image in article
  imageAlt: getFirstKeyMatch(['og:image:alt'], obj),
  locale: getFirstKeyMatch(['og:locale'], obj), //If not, check html lang tag
  url: getFirstKeyMatch(['og:url', 'url'], obj), //If not, use original url from request
  siteName: getFirstKeyMatch(['og:site_name'], obj),
  type: getFirstKeyMatch(['og:type', 'ogUrl'], obj), //, type, content-type
  video: getFirstKeyMatch(['og:video'], obj),
  videoType: getFirstKeyMatch(['og:video:type'], obj),
  themeColor: getFirstKeyMatch(['theme-color'], obj),
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
 */
export const extractMainContent = async (webpageText) => {
  const doc = new DOMParser().parseFromString(webpageText, 'text/html')
  console.log(processWebpageMetadata(extractWebpageMetadata(doc)))
  //console.log(extractWebpageMetadata(doc))
  console.log('hi')

  const t = Promise.resolve('foo')
  const article = new Promise((res, rej) => {
    try {
      res(new Readability(doc, { serializer: el => el }).parse())
    } catch(err) {
      rej(err)
    }
  })
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
