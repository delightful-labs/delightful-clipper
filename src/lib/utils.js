import sanitize from 'sanitize-html'
import { Readability } from '@mozilla/readability'
import { z } from 'zod'

/**
 * Linkedom DOM Document
 * @typedef { import('linkedom/types/html/document').HTMLDocument } HTMLDocument
 * @typedef { import('linkedom/types/interface/node-list').NodeList} NodeList
 */

/**
 * Takes an array of strings and an object and returns the first key found.
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
 * Merges two objects
 * @param {*} source 
 * @param {*} target 
 * @returns 
 */
//@todo: Add the ability to merge arrays.
//(Maybe as an option?)
export const deepMerge = (source, target) => {
  //@todo: check if object is not empty
  return Object.keys(source).reduce((obj, key) => {
    // if (isObject(source[key])) {
    //   obj[key] = deepMerge(source[key], target[key])
    //   return obj;
    // }

    obj[key] = !target[key] ? source[key] : target[key]

    return obj
  }, {})
}

/**
 * Gets any HTML meta tags
 * @param {HTMLDocument} doc 
 * @returns NodeList
 */
//Filter out only the meta tags I want (og:, description, charset, author)
//@TODO: Might be able to do this with querySelectorAll
//@TODO: handle when no meta is found?
export const extractHtmlMetadata = async (doc) => doc.getElementsByTagName('meta')

/**
 * Creates a JSON object from a nodeList of meta tags
 * @param {NodeList} meta 
 */
//@TODO: Add return type
export const createMetadataObject = (meta) => meta.reduce((previousValue, currentItem) => {
  return {...previousValue, [currentItem.getAttribute('property') || currentItem.getAttribute('name')]: currentItem.getAttribute('content')}
}, {})

/**
 * Filters out only the desired meta tags and renames them
 * @param {*} obj
 */
export const filterWebpageMetadata = (obj) => ({
  author: getFirstKeyMatch(['article:author', 'author'], obj), //article:author, author, articleTag (used by NYT) / Medium uses articleAuthor as url and author as string of name
  title: getFirstKeyMatch(['og:title', 'title'], obj), //If not, check html title
  datePublished: getFirstKeyMatch(['article:published_time', 'og:date'], obj),
  dateModified: getFirstKeyMatch(['article:modified_time', 'og:updated_time'], obj),
  description: getFirstKeyMatch(['og:description', 'description'], obj),
  _image: getFirstKeyMatch(['og:image', 'image'], obj), //If not, get first image in article
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
 * @param {NodeList} nodeList 
 */
export const processWebpageMetadata = async (nodeList) => {
  const obj = createMetadataObject(nodeList)
  const filtered = filterWebpageMetadata(obj)
  return filtered
}

/**
 * 
 * @param {string} lang 
 * @param {NodeList|null} meta 
 * @param {string} title 
 * @param {string} content 
 * @returns {string}
 */
export const createHtmlFromTemplate = (lang, meta, title, content) => `<!DOCTYPE html>
  <html lang="${lang}">
    <head>
      ${meta?.join('')}
      <title>${title}</title>
    </head>
    <body>
      ${content}
    </body>
  </html>`

/**
 * Uses readability to extract the main text of an HTML document
 * @typedef ReadabilityResponse
 * @type {object}
 * @property {string} title  article title
 * @property {string} byline author metadata
 * @property {string} dir content direction
 * @property {string} content HTML of processed article content
 * @property {string} textContent text content of the article (all HTML removed)
 * @property {number} length length of an article, in characters
 * @property {string} excerpt article description, or short excerpt from the content
 * @property {string} siteName name of the site
 * @property {string} lang content language
 * 
 * @param {Document} doc 
 * @returns {Promise<null|ReadabilityResponse>}
 */
export const extractMainContent = (doc, url) => new Promise((res, rej) => {
  try {
    res(new Readability(doc, { 
      serializer: el => {
        // Replaces relative URLs in media with absolute ones.
        [...el.querySelectorAll('image, img, video, audio')].forEach(el => {
          
          const src = el.getAttribute('src')

          if (!src.match(/^http/)) {
            el.setAttribute('src', url + src)
          }
          
        })
        
        return el.innerHTML
      }
    }).parse())
  } catch(err) {
    rej(err)
  }
})

/**
 * Sanitizes an HTML string
 * @param {string} doc 
 * @returns {Promise<string>}
 */
export const sanitizeHtml = (doc) => {
  const allowedTags = sanitize.defaults.allowedTags.concat([ 'img', 'details', 'summary', 'svg' ])
  return new Promise((res, rej) => {
    try {
      res(sanitize(doc, { allowedTags: allowedTags}))
    } catch(err) {
      rej(err)
    }
  })
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

/**
 * Checks if the provided string is a valid URL
 * @param {string} string 
 * @returns {boolean}
 */
export const isUrl = (string) => z.string().url().safeParse(string).success

/**
 * Checks if the provided string is a real object (Not array or null)
 * @param {*} obj 
 * @returns {boolean}
 */
export const isObject = (obj) => typeof obj === 'object' && obj !== null && !Array.isArray(obj)

/**
 * Combines arrays into first array, removing duplicate items.
 * @param {Array<*>} arr 
 * @param  {...Array<*>} args 
 * @returns 
 */
export const arrayUnion = (arr, ...args) => [...new Set(arr.concat(...args))]

/**
 * 
 * @param {string[]} arr 
 * @param {object} obj 
 * @returns 
 */
export const pick = (obj, arr) => arr.filter(key => key in obj).reduce((obj2, key) => (obj2[key] = obj[key], obj2), {})
