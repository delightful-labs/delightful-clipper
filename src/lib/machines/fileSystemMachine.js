import { createMachine, interpret, assign, send } from 'xstate'
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
//@TODO: make this complete to type
const createArticleEntry = (url) => {
  return {
    url: url,
    id: uuidv4(),
    fileName: ''
  }
}

const fileSystemMachine = createMachine({
  context: {
    db: [],
    dbPath: wn.path.file('private', 'db.json'),
    fs: null,
    url: '',
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
          actions: assign({ db: (_, evt) => evt.data.content }),
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
                SAVE_ARTICLE: {
                  target: 'checkingIfArticleIsDuplicate',
                  //@TODO: trim unused whitespace
                  actions: assign({ url: (_, evt) => evt.data.url })
                }
              }
            },
            checkingIfArticleIsDuplicate: {
              invoke: {
                src: async (ctx) => await jsonata(`$boolean($[url = "${ctx.url}"])`).evaluate(ctx.db),
                onDone: [
                  { 
                    cond: (_, evt) => evt.data,
                    target: 'articleAlreadyExists'
                  },
                  { 
                    cond: (_, evt) => !evt.data,
                    target: 'updatingDatabase',
                    actions: assign({ db: (ctx) => [...ctx.db, createArticleEntry(ctx.url) ] })
                  }
                ],
                onError: {} //@TODO: handle error
              }
            },
            //@todo: updatingDatabase & publishing are functions that automaticActions could also use.
            //How to keep them from stepping on each other?
            //Maybe an event bus?
            updatingDatabase: {
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
                  target: 'idle',
                  actions: send('CHECK_FOR_UNPARSED_ARTICLE')
                },
                onError: {} //@TODO: handle error
              }
            },
            //@TODO: What to do with this state?
            articleAlreadyExists: {
              entry: send('CHECK_FOR_UNPARSED_ARTICLE'),
              after: {
                // after 1 second, transition to yellow
                500: { target: 'idle' }
              }
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
            parsingArticle: {
              invoke: {
                src: (_, evt) => fetch('/add', { method: 'post', body: JSON.stringify({url: evt.data.url})}),
                onDone: {
                  actions: (_, evt) => console.log(evt)
                }
              }
              //entry: (ctx, evt) => console.log(evt)
            }
          }
        }
      }
    },
    error: {}
  }
})

// Add functions to actions object.

export const fileSystemService = interpret(fileSystemMachine).start()
