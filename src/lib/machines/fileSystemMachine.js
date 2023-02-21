import { createMachine, interpret, assign, send } from 'xstate'
import { assign as immerAssign } from '@xstate/immer'
import * as wn from 'webnative'
import { v4 as uuidv4 } from 'uuid'
import jsonata from 'jsonata'
import Article from '$lib/schemas/Article'
import articleParserMachine from '$lib/machines/articleParserMachine'
import { writeToFileSystem, uint8ArrayToString } from '$lib/files'

/**
 * @typedef { import('webnative/fs/index').default } FileSystem
 * @typedef { import('$lib/schemas/Article').Article } Article
 * @typedef { import('webnative/path').FilePath} FilePath
 */

/**
 * Creates a new article object.
 * @param {string} url
 * @returns {Article|undefined}
 */
const createArticleEntry =  (url) => Article.parse({
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
        src: () => wn.program({
          namespace: { creator: "Delightful Labs", name: "Clipper" }
        }),
        onDone: {
          target: 'checkingForDb',
          actions: assign({fs: (_, evt) => evt.data.session.fs})
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
          actions: assign({ db: (_, evt) => JSON.parse(uint8ArrayToString(evt.data.content)) }),
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
          // on: {
          //   SAVE_ARTICLE: {target: 'userActions.test'}
          // },
          states: {
            idle: {
              entry: send('CHECK_FOR_UNPARSED_ARTICLE'),
              on: {
                SAVE_ARTICLE: [
                  //@TODO: need to send back logical events to show visual updates to user. And clear the form on success.
                  //@TODO: trim URL of whitespace
                  //@TODO: also need to remove UTM and other tracking stuff.
                  //BUT --- there may be sometimes you want URL parameters as part of the URL, such as saving something from a web app.
                  //Will probably need to make it an option to save search parameters or not.
                  { 
                    cond: (ctx, evt) => jsonata(`url = "${evt.data.url}"`).evaluate(ctx.db),
                    target: 'articleAlreadyExists'                     
                  },
                  { 
                    target: 'updatingDatabase',
                    actions: assign({ db: (ctx, evt) => [...ctx.db, createArticleEntry(evt.data.url) ] })
                  },
                ],
                ERASE_DATABASE: {
                  target: 'updatingDatabase',
                  actions: assign({ db: []})
                }
              }
            },
            test: {
              invoke: {
                src: (ctx, evt) => articleParserMachine(createArticleEntry(evt.data.url), ctx.fs),
                onDone: {
                  actions: (_, evt) => console.log(evt)
                },
                onError: {} // @TODO: handle error
              },
              on: {
                'PARSING_FINISHED': {
                  actions: (ctx, evt) => console.log(evt)
                }
              }
            },
            //@todo: updatingDatabase & publishing are functions that automaticActions could also use.
            //How to keep them from stepping on each other?
            //Maybe an event bus?
            //@TODO: can add { publish: true } to fs.write to skip publishing step!
            updatingDatabase: {
              invoke: {
                src: (ctx) => writeToFileSystem(ctx.dbPath, JSON.stringify(ctx.db), ctx.fs),
                onDone: {
                  target: 'idle',
                  actions: send('CHECK_FOR_UNPARSED_ARTICLE')
                },
                onError: {} //@TODO: handle error
              }
            },
            //@TODO: What to do with this state?
            articleAlreadyExists: {
              //@TODO: Add tags to existing entry, if they exist
              // entry: send('CHECK_FOR_UNPARSED_ARTICLE'),
              after: {
                500: { target: 'idle' }
              }
            }
          }
        },
        automaticActions: {
          initial: 'checkingForUnparsedArticle',
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
                src: async (ctx) => await jsonata(`$$#$i[filePath=[] and _file=''][0].$merge([$, {'_index':$i}])`).evaluate(ctx.db),
                onDone: [
                  {
                    cond: (_, evt) => evt.data,
                    target: 'parsingArticle',
                    actions: (_, evt) => console.log(evt.data)
                  },
                  {
                    cond: (_, evt) => !evt.data,
                    target: 'idle',
                    actions: (_, evt) => console.log('no unparsed articles')
                  }
                ],
                onError: {}
              }
            },
            parsingArticle: {
              invoke: {
                src: (ctx, evt) => articleParserMachine(evt.data, ctx.fs),
                onError: {} // @TODO: handle error
              },
              on: {
                'PARSING_FINISHED': {
                  target: 'updatingDatabase',
                  actions: immerAssign((ctx, evt) => {
                    ctx.db[evt.data._index] = evt.data
                  })
                }
              }
            },
            savingImages: {
              // 1. Main image
              // 2. Article images
              // 3. Other media? (videos, audio)
              // import { PublicFile } from "webnative/fs/v1/PublicFile"

              // const tempFile = await PublicFile.create(
              //   program.components.depot,
              //   pictureBytes // the content
              // )

              // const cid = await tempFile.put()

              // await fs.write(
              //   webnative.path.file("public", "pictures", cid.toString()),
              //   pictureBytes
              // )

              // // later
              // await fs.read(
              //   webnative.path.file("public", "pictures", cidString)
              // )
            },
            updatingDatabase: {
              invoke: {
                src: (ctx) => writeToFileSystem(ctx.dbPath, JSON.stringify(ctx.db), ctx.fs),
                onDone: {
                  target: 'idle',
                  actions: send('CHECK_FOR_UNPARSED_ARTICLE')
                },
                onError: {} //@TODO: handle error
              }
            },
          }
        }
      }
    },
    error: {}
  }
})

// Add functions to actions object.

export const fileSystemService = interpret(fileSystemMachine).start()
