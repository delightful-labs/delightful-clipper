import { createMachine, interpret, assign } from 'xstate'
import * as wn from 'webnative'
import { v4 as uuidv4 } from 'uuid'
import jsonata from 'jsonata'

const articleTemplate = {
  title: 'Noosphere, a protocol for thought',
  url: 'https://subconscious.substack.com/p/noosphere-a-protocol-for-thought',
  image: '',
  tags: ['TfT', 'protocols']
}

const articleTemplate2 = {
  title: 'Wiki as a Commons',
  url: 'https://subconscious.substack.com/p/wiki-as-a-commons',
  image: '',
  tags: ['TfT']
}

/**
 * 
 * @param {string} url 
 */
const createArticleEntry = (url) => {
  return {
    url: url,
    id: uuidv4()
  }
}

const fileSystemMachine = createMachine({
  context: {
    db: [],
    dbPath: wn.path.file('private', 'db.json'),
    fs: null,
    url: ''
  },
  initial: 'settingUpFs',
  id: 'fs',
  //predictableActionArguments: true,
  states: {
    settingUpFs: {
      invoke: {
        src: () => wn.app({ useWnfs: true }),
        onDone: {
          target: 'checkingForDb',
          actions: assign({fs: (_, evt) => evt.data.fs})
        },
        onError: {
          actions: (_, evt) => console.log(evt),
          target: 'error'
        }
      }
    },
    checkingForDb: {
      invoke: {
        src: (ctx) => ctx.fs.exists(ctx.dbPath),
        onDone: [
          { 
            cond: (_, evt) => !evt.data,
            target: 'ready'
          },
          { 
            cond: (_, evt) => evt.data,
            target: 'loadingDb'
          }
        ],
        onError: {
          actions: (c,e) => console.log(e) //@TODO: handle error
        }
      }
    },
    loadingDb: {
      invoke: {
        src: (ctx) => ctx.fs.get(ctx.dbPath),
        onDone: {
          actions: assign({ db: (_, evt) => evt.data.content }),
          target: 'ready'
        },
        onError: {
          actions: (_, evt) => console.log(evt)
        } //@TODO: handle error
      }
    },
    ready: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            SAVE_ARTICLE: {
              target: 'checkingIfArticleIsDuplicate',
              //@TODO: trim unused whitespace
              actions: assign({ url: (_, evt) => evt.data.url })
            }
          }
        },
        checkingIfArticleIsDuplicate: {
          invoke: {
            src: async (ctx) => await jsonata(`url="${ctx.url}"`).evaluate(ctx.db),
            onDone: [
              { 
                cond: (_, evt) => evt.data,
                target: 'articleAlreadyExists'
              },
              { 
                cond: (_, evt) => !evt.data,
                target: 'savingArticle',
                actions: assign({ db: (ctx) => [...ctx.db, createArticleEntry(ctx.url) ] })
              }
            ],
            onError: {} //@TODO: handle error
          }
        },
        savingArticle: {
          invoke: {
            src: (ctx) => ctx.fs.write(ctx.dbPath, ctx.db),
            onDone: {
              target: 'publishing'
            },
            onError: {} //@TODO: handle error
          }
        },
        publishing: {
          invoke: {
            src: (ctx) => ctx.fs.publish(),
            onDone: {
              target: 'idle'
            },
            onError: {} //@TODO: handle error
          }
        },
        //@TODO: What to do with this state?
        articleAlreadyExists: {}
      }
    },
    error: {}
  }
})

// Add functions to actions object.

export const fileSystemService = interpret(fileSystemMachine).start()
