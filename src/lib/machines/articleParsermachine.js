import { createMachine } from 'xstate'
import * as wn from 'webnative'
import { assign as immerAssign } from '@xstate/immer'
import { extractMainContent, processWebpageMetadata } from '$lib/utils'

/**
 * @param { import('$lib/schemas/Article').Article } article
 * @param { import('webnative/fs/index').default } fs
 */
const articleParserMachine = (article, fs) => createMachine({
  context: {
    fs: fs,
    article: article,
    articleText: ''
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
            target: 'readingHtmlText',
            actions: (_,evt) => console.log('html')
          },
          {
            target: 'loadingFile',
            actions: (_,evt) => console.log('not html')
          }
        ],
        onError: {} // @TODO: handle error
      }
    },
    readingHtmlText: {},
    loadingFile: {},
    parsingMetadata: {},
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
