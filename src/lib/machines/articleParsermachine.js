import { createMachine } from 'xstate'
import * as wn from 'webnative'
import { assign as immerAssign } from '@xstate/immer'
import { extractMainContent, processWebpageMetadata } from '$lib/utils'

/**
 * @param { import('$lib/schemas/Article') } article
 * @param { import('webnative/fs/index').default } fs
 */
const articleParserMachine = (article, fs) => createMachine({
  context: {
    fs: fs,
    article: article,
    articleText: ''
  },
  initial: 'parsingArticle',
  states: {
    parsingArticle: {
      invoke: {
        src: (ctx) => fetch('/fetch-article', { method: 'post', body: JSON.stringify(ctx.article)}).then(res => res.json()),
        onDone: {
          target: 'extractingMainContent'
        },
        onError: {} // @TODO: handle error
      }
    },
    extractingMainContent: {
      invoke: {
        src: (ctx) => extractMainContent(ctx.body, ctx.article.locale),
        onDone: {
          target: 'savingArticleText',
          actions: immerAssign((ctx, evt) => {
            ctx.article._rawBody = evt.data.body
            ctx.article.wordCount = evt.data.wordCount
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
