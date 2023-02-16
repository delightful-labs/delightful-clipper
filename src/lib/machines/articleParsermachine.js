import { createMachine, assign, sendParent } from 'xstate'
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
            target: 'readingHtmlText',
            actions: immerAssign((ctx, evt) => {
              ctx.article.mimeType = evt.data.type
            })
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
          actions: assign({ 
            //@todo: clean this up.
            //If I create a function out of it and invoke it, I can have it as the evt.data for the final state
            article: (ctx, evt) => deepMerge(ctx.article, { siteName: evt.data.siteName, locale: evt.data.lang, title: evt.data.title, wordCount: getWordCount(evt.data.textContent)}),
            articleText: (_, evt) => evt.data.content
          }),
          target: 'compilingFromTemplate',
        }
      }
    },
    compilingFromTemplate: {
      invoke: {
        src: async (ctx, evt) => {
          const html = await createHtmlFromTemplate(ctx.article.locale, ctx.htmlMetadata, ctx.article.title, ctx.articleText)
          const completeArticle = ctx.article
          completeArticle._file = html
          return completeArticle
        },
        onDone: {
          actions: sendParent((_, evt) => ({type: 'PARSING_FINISHED', data: evt.data})),
          target: 'done'
        }
      }
    },
    done: {
      type: 'final'
    }
  }
})

export default articleParserMachine
