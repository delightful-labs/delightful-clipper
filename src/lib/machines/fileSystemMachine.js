import { createMachine, interpret, assign, send } from 'xstate'
import * as wn from 'webnative'
import { v4 as uuidv4 } from 'uuid'
import jsonata from 'jsonata'
import Article from '$lib/schemas/Article'

/**
 * @typedef { import('webnative/fs/index').default } FileSystem
 * @typedef { import('$lib/schemas/Article').Article } Article
 * @typedef { import('webnative/path').FilePath} FilePath
 */

/**
 * Creates a new article object.
 * @param {string} url 
 * @returns Article
 */
const createArticleEntry = (url) => Article.parse({
  dateAdded: new Date().toISOString(),
  id: uuidv4(),
  url: url
})

const fileSystemMachine = createMachine({
  context: {
    /** @type {Array<Article>} */
    db: [],
    /** @type {FilePath} */
    dbPath: wn.path.file('private', 'db.json'),
    /** @type {FileSystem|null} */
    fs: null,
    /** @type {string} */
    //@TODO: change to enum of possible states
    networkStatus: 'online'
  },
  initial: 'settingUpFs',
  id: 'fs',
  predictableActionArguments: true,
  // need to keep track of network status.
  // I might set it at a higher level and just repeat it here in context,
  // Then I don't have to repeat the logic.
  // Many different networks statuses:
  // 1. Online
  //    a. Unlimited
  //    b. Datasaver + cellular -> automatic parsing might be turned off
  //    c. Low power mode?
  // 2. Offline
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
          actions: assign({ db: (_, evt) => JSON.parse(evt.data.content) }),
          target: 'ready'
        },
        onError: {
          actions: (_, evt) => console.log(evt)
        } //@TODO: handle error
      }
    },
    ready: {
      type: 'parallel',
      // It might be cleaner to make these states actors.
      states: {
        userActions: { 
          initial: 'idle',
          states: {
            idle: {
              on: {
                SAVE_ARTICLE: [
                    // @TODO: I broke this. Needs to be reworked. Might be best to create an article saving machine or function to invoke.
                    { 
                      cond: (ctx, evt) => jsonata(`$boolean($[url = "${evt.data.url}"])`).evaluate(ctx.db),
                      target: 'updatingDatabase',
                      // actions: async (ctx, evt) => {
                      //   const test = await jsonata(`$boolean($[url = "${evt.data.url}"])`).evaluate(ctx.db)
                      //   console.log(test)
                      // }
                      actions: (ctx,evt,meta) => console.log(meta)
                      //actions: (ctx, evt) => console.log(jsonata(`$boolean($[url = "${evt.data.url}"])`).evaluate(ctx.db))
                      //actions: assign({ db: (ctx) => [...ctx.db, createArticleEntry(evt.data.) ] })
                    },
                    { 
                      target: 'articleAlreadyExists',
                      actions: (ctx,evt,meta) => console.log(meta)
                    },
                  //target: 'checkingIfArticleIsDuplicate',
                  //@TODO: trim unused whitespace
                  //Might be able to do this with Zod
                  //And verify that it is a valid URL
                  //@TODO: I think I can just pass this in event instead of saving to context...
                  //actions: assign({ url: (_, evt) => evt.data.url })
                ],
                ERASE_DATABASE: {
                  target: 'updatingDatabase',
                  actions: assign({ db: []})
                }
              }
            },
            checkingIfArticleIsDuplicate: {
              invoke: {
                src: async (ctx, evt) => await jsonata(`$boolean($[url = "${evt.data.url}"])`).evaluate(ctx.db),
                onDone: [
                  //{ actions: (_, evt) => console.log(evt.data)}
                  { 
                    cond: (_, evt) => evt.data,
                    target: 'articleAlreadyExists'
                  },
                  { 
                    cond: (_, evt) => !evt.data,
                    target: 'updatingDatabase',
                    actions: (_, evt) => console.log(evt.data)//assign({ db: (ctx) => [...ctx.db, createArticleEntry(evt.data.) ] })
                  }
                ],
                onError: {} //@TODO: handle error
              }
            },
            //@todo: updatingDatabase & publishing are functions that automaticActions could also use.
            //How to keep them from stepping on each other?
            //Maybe an event bus?
            //@TODO: can add { publish: true } to fs.write to skip publishing step!
            updatingDatabase: {
              invoke: {
                src: (ctx) => ctx.fs.write(ctx.dbPath, JSON.stringify(ctx.db), { publish: true }),
                onDone: {
                  target: 'idle',
                  actions: send('CHECK_FOR_UNPARSED_ARTICLE')
                },
                onError: {} //@TODO: handle error
              }
            },
            //@TODO: What to do with this state?
            articleAlreadyExists: {
              // entry: send('CHECK_FOR_UNPARSED_ARTICLE'),
              // after: {
              //   // after 1 second, transition to yellow
              //   500: { target: 'idle' }
              // }
            }
          }
        },
        automaticActions: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                CHECK_FOR_UNPARSED_ARTICLE: {
                  target: 'checkingForUnparsedArticle'
                }
              }
            },
            checkingForUnparsedArticle: {
              invoke: {
                src: async (ctx) => await jsonata(`$$[fileName=""][0]`).evaluate(ctx.db),
                onDone: [
                  {
                    cond: (_, evt) => evt.data,
                    target: 'parsingArticle'
                  },
                  {
                    cond: (_, evt) => !evt.data,
                    target: 'idle'
                  }
                ],
                onError: {}
              }
            },
            //@TODO: make this an actor and combine with machine from /add/+server.js.
            // /add/+server.js can just become a proxy for fetching.
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
        }
      }
    },
    error: {}
  }
})

// Add functions to actions object.

export const fileSystemService = interpret(fileSystemMachine).start()
