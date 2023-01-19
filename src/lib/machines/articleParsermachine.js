import { createMachine, assign } from 'xstate'
import * as wn from 'webnative'
import { assign as immerAssign } from '@xstate/immer'
import { deepMerge, extractMainContent, extractHtmlMetadata, processWebpageMetadata } from '$lib/utils'
import { DOMParser } from 'linkedom'

/**
 * @typedef { import('$lib/schemas/Article').Article } article
 * @typedef { import('webnative/fs/index').default } fs
 * @typedef { import('linkedom/types/html/document').HTMLDocument } HTMLDocument
 */

/**
 * @param { article } article
 * @param { fs } fs
 */
const articleParserMachine = (article, fs) => createMachine({
  context: {
    /** @type {fs} */
    fs: fs,
    /** @type {article} */
    article: article,
    /** @type {string} */
    articleText: '',
    /** @type {null|HTMLDocument} */
    dom: null,
    /** @type {null|NodeList} */
    htmlMetadata: null
  },
  initial: 'fetchingArticle',
  states: {
    fetchingArticle: {
      invoke: {
        src: (ctx) => fetch(
          `/proxy?url=${encodeURI(ctx.article.url)}`, 
          { method: 'get' })
          .then(res => res.blob()
        ),
        onDone: [
          { 
            cond: (_, evt) => evt.data.type.match(/text\/html/),
            target: 'readingHtmlText'
          },
          {
            target: 'loadingFile',
            //actions: (_,evt) => console.log('not html')
          }
        ],
        onError: {
          actions: (_, evt) => console.log(evt)
        } // @TODO: handle error
      }
    },
    readingHtmlText: {
      invoke: {
        src: (_, evt) => evt.data.text(),
        onDone: {
          actions: assign({ 
            articleText: (_, evt) => evt.data,
            dom: (_, evt) =>  new DOMParser().parseFromString(evt.data, 'text/html')
          }),
          target: 'parsingMetadata'
        }
      }
    },
    loadingFile: {},
    parsingMetadata: {
      invoke: {
        src: (ctx, evt) => extractHtmlMetadata(ctx.dom),
        onDone: {
          target: 'creatingArticleObject',
          actions: assign({ htmlMetadata: (_, evt) => evt.data })
        },
        onError: {
          actions: (ctx, evt) => console.error(evt.data)
        }
      }
    },
    creatingArticleObject: {
      invoke: {
        src: (ctx, evt) => processWebpageMetadata(ctx.htmlMetadata),
        onDone: {
          //target: 'creatingArticleObject',
          //actions: assign({ htmlMetadata: (_, evt) => evt.data })
          //@TDOD: safeParse with zod and merge with existing ctx article.
          actions: (ctx, evt) => console.log(deepMerge(ctx.article, evt.data))
        },
        onError: {
          actions: (ctx, evt) => console.error(evt.data)
        }
      }
    },
    extractingMainContent: {
      invoke: {
        src: (ctx) => extractMainContent(ctx.body, ctx.article.locale),
        onDone: {
          target: 'savingArticleText',
          actions: immerAssign((ctx, evt) => {
            ctx.articleText = evt.data.body
            //ctx.article.wordCount = evt.data.wordCount
            ctx.article.mimeType = ctx.response.headers['content-type']
          })
        }
      }
    },
    //@TODO: Probably should check with db after loaded article and have canonical URL to make sure that it doesn't already exist. 
    // That will fix the issue of URL shorteners producing multiple entries ---
    // i.e. I could save the same URL with a t.co and a bit.ly shortened URL and not even know it. 
    savingArticleText: {
      invoke: {
        src: (ctx, evt) => ctx.fs.write( wn.path.file('public', 'web-pages', encodeURIComponent(evt.data.url), 'index.html'), evt.data._rawBody, { publish: true }),
        onDone: {
          actions: (_, evt) => console.log(evt)
          // Add fileName to object
        },
        onError: {
          actions: (_, evt) => console.log(evt)
        }
      }
    },
    savingImages: {
      // 1. Main image
      // 2. Article images
      // 3. Other media? (videos, audio)
    },
    updateDbWithArticle: {},
    saveDbToWnfs: {}
  }
})

export default articleParserMachine
