import { createMachine } from 'xstate'
import * as wn from 'webnative'

/**
 * @param { import('$lib/schemas/Article') } article
 * @param { import('webnative/fs/index').default } fs
 */
const articleParserMachine = (article, fs) => createMachine({
  context: {
    fs: fs,
    article: article
  },
  initial: 'parsingArticle',
  states: {
    parsingArticle: {
      invoke: {
        src: (_, evt) => fetch('/add', { method: 'post', body: JSON.stringify({url: evt.data.url})}).then(res => res.json()),
        onDone: {
          target: 'savingArticleText'
        },
        onError: {} // @TODO: handle error
      }
    },
    // @TODO: What to do with the article object?
    // Pass it along through transitions?
    // Save it to context? (If I did this, it would make sense if this was an invoked macine that receive the fs as a parameter)

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
