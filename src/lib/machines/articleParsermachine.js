import { createMachine, assign } from 'xstate'
import * as wn from 'webnative'
import { assign as immerAssign } from '@xstate/immer'
import { createHtmlFromTemplate, deepMerge, extractMainContent, extractHtmlMetadata, processWebpageMetadata, getWordCount } from '$lib/utils'
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
  predictableActionArguments: true,
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
            //@todo: action to use immer to set mimetype
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
          target: 'extractingMainContent',
          actions: assign({article: (ctx, evt) =>  deepMerge(ctx.article, evt.data)})
        },
        onError: {
          actions: (ctx, evt) => console.error(evt.data)
        }
      }
    },
    extractingMainContent: {
      invoke: {
        src: (ctx) => extractMainContent(/** @type {HTMLDocument & Document} */(ctx.dom)),
        onDone: {
          //actions: (ctx, evt) => console.log(evt)
          //@todo: save data:
          // 5. combine HTML with template
          // 6. save html to IPFS
          // 7. add fileName to article
          actions: assign({ 
            article: (ctx, evt) => deepMerge(ctx.article, { siteName: evt.data.siteName, locale: evt.data.lang, title: evt.data.title, wordCount: getWordCount(evt.data.textContent)}),
            articleText: (_, evt) => evt.data.content
          }),
          target: 'savingArticleText',
        }
      }
    },
    //@TODO: Probably should check with db after loaded article and have canonical URL to make sure that it doesn't already exist. 
    // That will fix the issue of URL shorteners producing multiple entries ---
    // i.e. I could save the same URL with a t.co and a bit.ly shortened URL and not even know it. 
    savingArticleText: {
      entry: (ctx) => console.log(createHtmlFromTemplate(ctx.article.locale, ctx.htmlMetadata, ctx.article.title, ctx.articleText))
      // invoke: {
      //   src: (ctx, evt) => ctx.fs.write( wn.path.file('public', 'web-pages', encodeURIComponent(evt.data.url), 'index.html'), evt.data._rawBody, { publish: true }),
      //   onDone: {
      //     actions: (_, evt) => console.log(evt)
      //     // Add fileName to object
      //   },
      //   onError: {
      //     actions: (_, evt) => console.log(evt)
      //   }
      // }
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
