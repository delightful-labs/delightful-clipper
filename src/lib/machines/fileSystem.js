import { createMachine, interpret, assign, send, sendParent } from 'xstate'
import { assign as immerAssign } from '@xstate/immer'
import * as odd from '@oddjs/odd'
import { v4 as uuidv4 } from 'uuid'
import jsonata from 'jsonata'
import Article from '$lib/schemas/Article'
import articleParserMachine from '$lib/machines/articleParser'
import { writeToFileSystem, uint8ArrayToString } from '$lib/files'
import { arrayUnion } from '$lib/utils'
import { interpretInWebWorker } from '$lib/machine-helpers/from-web-worker'

/**
 * @typedef { import('@oddjs/odd/fs/index').default } FileSystem
 * @typedef { import('$lib/schemas/Article').Article } Article
 * @typedef { import('@oddjs/odd/path/index').FilePath<*> } FilePath
 */

/**
 * Creates a new article object.
 * @param {string} url
 * @param {string[]|undefined} tags
 * @returns {Article|undefined}
 */
const createArticleEntry =  (url, tags) => Article.parse({
  dateAdded: new Date().toISOString(),
  id: uuidv4(),
  url: url,
  tags: tags||[]
})

/**
 * 
 * @param {string} message 
 * @returns {*}
 */
const createErrorNotification = (message) => ({ 
  type: 'NOTIFY', 
  data: { 
    type: 'error', 
    timeout: 30000, 
    message: message 
}})

/**
 * @param {string} url 
 * @param {Array<Article>} db 
 */
const getArticle = async (url, db) => await jsonata(`$$#$i[url = "${url}"].$merge([$, {'_index':$i}])`).evaluate(db)

const fileSystemMachine = createMachine({
  context: {
    /** @type {Array<Article>} */
    db: [],
    /** @type {FilePath} */
    dbPath: odd.path.file('private', 'db.json'),
    /** @type {FileSystem|null} */
    fs: null,
    /** @type {string} */
    //@TODO: change to enum of possible states
    networkStatus: 'online',
    unsavedArticles: [],
    feedsPath: odd.path.file('private', 'feeds.json'),
    feeds: []
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
        src: () => odd.program({
          namespace: { creator: "Delightful Labs", name: "Clipper" }
        }),
        onDone: {
          target: 'checkingForDb',
          actions: assign({fs: (_, evt) => evt.data.session.fs})
        },
        onError: {
          actions: sendParent((_, evt) => createErrorNotification(evt.data)),
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
          actions: sendParent((_, evt) => createErrorNotification(evt.data)),
        }
      }
    },
    loadingDb: {
      invoke: {
        src: (ctx) => ctx.fs.get(ctx.dbPath),
        onDone: {
          actions: [
            assign({ db: (_, evt) => JSON.parse(uint8ArrayToString(evt.data.content)) }),
            sendParent({ type: 'FILESYSTEM_INITIATED' })
          ],
          target: 'ready'
        },
        onError: {
          actions: sendParent((_, evt) => createErrorNotification(evt))
        }
      }
    },
    ready: {
      type: 'parallel',
      // It might be cleaner to make these states actors.
      states: {
        userActions: { 
          initial: 'idle',
          entry: sendParent((ctx) => ({type: 'UPDATE_DATABASE', data: ctx.db})),
          on: {
            SAVE_ARTICLE: {
              //@TODO: trim URL of whitespace
              //@TODO: also need to remove UTM and other tracking stuff.
              //BUT --- there may be sometimes you want URL parameters as part of the URL, such as saving something from a web app.
              //Will probably need to make it an option to save search parameters or not.
              actions: [
                immerAssign((ctx, evt) => {
                  ctx.unsavedArticles.push(evt.data)
                }),
                send('CHECK_FOR_UNSAVED_ARTICLE')
              ]
            },
          },
          states: {
            idle: {
              entry: send('CHECK_FOR_UNPARSED_ARTICLE'),
              on: {
                DELETE_ARTICLE: {
                  target: 'deletingArticle'
                },
                UPDATE_ARTICLE: {
                  target: 'updatingArticle'
                },
                LOAD_CONTENT: {
                  target: 'loadingContent'
                },
                ERASE_DATABASE: {
                  target: 'updatingDatabase',
                  actions: assign({ db: []})
                }
              }
            },
            loadingContent: {
              invoke: {
                src: async (ctx, evt) => {
                  const file = await ctx.fs.get(evt.data.filePath)
                  return { 
                    filePath: evt.data.filePath, 
                    content: uint8ArrayToString(file.content)
                  }
                },
                onDone: {
                  actions: sendParent((_, evt) => ({ type: 'CONTENT_LOADED', data: evt.data })),
                  target: 'idle'
                }
              }
            },
            updatingArticle: {
              invoke: {
                src: async (ctx, evt) => {
                  const existingArticle = await getArticle(evt.data.url, ctx.db)

                  return { existingArticle: existingArticle, article: evt.data}
                },
                onDone: { 
                  target: 'updatingDatabase',
                  actions: [
                    immerAssign((ctx, evt) => {
                      const update = {...ctx.db[evt.data.existingArticle._index], ...evt.data.article}
                      const parsedUpdate = Article.parse(update)
                      ctx.db[evt.data.existingArticle._index] = parsedUpdate
                    }),
                    sendParent(() => ({ type: 'ARTICLE_UPDATED' }))
                  ]
                }
              }
            },
            deletingArticle: {
              invoke: {
                src: (ctx, evt) => getArticle(evt.data.url, ctx.db),
                onDone: { 
                  target: 'updatingDatabase',
                  actions: [
                    immerAssign((ctx, evt) => {
                      ctx.db.splice(evt.data._index, 1)
                    }),
                    sendParent(() => ({ 
                      type: 'NOTIFY', 
                      data: { 
                        type: 'success', 
                        timeout: 5000, 
                        message: 'Article Deleted' 
                      }
                    }))
                  ]
                }
              }
            },
            updatingDatabase: {
              invoke: {
                src: (ctx) => writeToFileSystem(ctx.dbPath, JSON.stringify(ctx.db), ctx.fs),
                onDone: {
                  target: 'idle',
                  actions: [
                    send('CHECK_FOR_UNPARSED_ARTICLE'),
                    sendParent((ctx) => ({type: 'UPDATE_DATABASE', data: ctx.db})),
                  ]
                },
                onError: {
                  actions: sendParent((_, evt) => createErrorNotification(evt))
                }
              }
            }
          }
        },
        automaticActions: {
          initial: 'checkingForUnsavedArticle',
          states: {
            idle: {
              on: {
                CHECK_FOR_UNPARSED_ARTICLE: {
                  target: 'checkingForUnparsedArticle'
                },
                CHECK_FOR_UNSAVED_ARTICLE: {
                  target: 'checkingForUnsavedArticle'
                }
              }
            },
            checkingForRssFeedsList: {
              invoke: {
                src: (ctx) => ctx.fs.exists(ctx.feedsPath),
                onDone: [
                  { 
                    cond: (_, evt) => !evt.data,
                    target: 'checkingForUnsavedArticle'
                  },
                  { 
                    cond: (_, evt) => evt.data,
                    target: 'loadingRssFeedsList'
                  }
                ],
                onError: {
                  actions: sendParent((_, evt) => createErrorNotification(evt.data)),
                }
              }
            },
            loadingRssFeedsList: {
              invoke: {
                src: (ctx) => ctx.fs.get(ctx.dbPath),
                onDone: {
                  actions: [
                    assign({ db: (_, evt) => JSON.parse(uint8ArrayToString(evt.data.content)) }),
                  ],
                  target: 'checkingForUnsavedArticle'
                },
                onError: {
                  actions: sendParent((_, evt) => createErrorNotification(evt))
                }
              }
            },
            checkingForUnsavedArticle: {
              always: [
                {
                  cond: (ctx) => ctx.unsavedArticles.length > 0,
                  target: 'checkingIfUnsavedArticleAlreadyExists',
                  actions: (ctx)=> console.log(ctx.unsavedArticles)
                },
                {
                  target: 'checkingForUnparsedArticle',
                  actions: (ctx)=> console.log('No articles to save')
                }
              ]
            },
            checkingIfUnsavedArticleAlreadyExists: {
              invoke: {
                src: async (ctx) => {
                  const existingArticle = await jsonata(`$$#$i[url = "${ctx.unsavedArticles[0].url}"].$merge([$, {'_index':$i}])`).evaluate(ctx.db)

                  return { existingArticle: existingArticle, article: ctx.unsavedArticles[0]}
                },
                onDone: [
                  { 
                    cond: (_, evt) => evt.data.existingArticle && evt.data.article.tags.length,
                    target: 'idle',
                    actions: [
                      sendParent(() => ({type: 'ARTICLE_ALREADY_EXISTS'})),
                      immerAssign((ctx, evt) => {
                        ctx.unsavedArticles.shift()
                        ctx.db[evt.data.existingArticle._index].tags = arrayUnion(ctx.db[evt.data.existingArticle._index].tags, evt.data.article.tags)
                      })
                    ]           
                  },
                  { 
                    actions: [
                      sendParent(() => ({type: 'ARTICLE_ALREADY_EXISTS'})),
                      immerAssign((ctx, evt) => {
                        ctx.unsavedArticles.shift()
                      })
                    ],
                    cond: (_, evt) => evt.data.existingArticle,
                    target: 'idle',
                  },
                  { 
                    target: 'updatingDatabase',
                    actions: [
                      immerAssign((ctx, evt) => {
                        ctx.unsavedArticles.shift()
                        ctx.db.push(createArticleEntry(evt.data.article.url, evt.data.article.tags))
                      }),
                      sendParent(() => ({type: 'ARTICLE_SAVED'}))
                    ]
                  }
                ]
              }
            },
            checkingForUnparsedArticle: {
              invoke: {
                src: async (ctx) => await jsonata(`$$#$i[filePath.file=[] and _file=''][0].$merge([$, {'_index':$i}])`).evaluate(ctx.db),
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
                onError: {
                  actions: sendParent((_, evt) => createErrorNotification(evt.data.message))
                }
              }
            },
            parsingArticle: {
              invoke: {
                src: (ctx, evt) => articleParserMachine(evt.data, ctx.fs),
                onError: {
                  actions: sendParent((_, evt) => createErrorNotification(evt.data))
                }
              },
              on: {
                'PARSING_FINISHED': {
                  target: 'checkingIfAlreadyExists'
                }
              }
            },
            checkingIfAlreadyExists: {
              invoke: {
                src: async (ctx, evt) => {
                  const existingArticle = await jsonata(`$$#$i[url = "${evt.data.url}" and id != "${evt.data.id}"].$merge([$, {'_index':$i}])`).evaluate(ctx.db)

                  return { existingArticle: existingArticle, article: evt.data}
                },
                onDone: [
                  //If URL already exists, discard the entry.
                  //This can happen when a URL is added that is not canonical.
                  //@todo: merge tags to existing entry.
                  { 
                    cond: (_, evt) => evt.data.existingArticle && evt.data.article.tags.length,
                    target: 'updatingDatabase',
                    actions: immerAssign((ctx, evt) => {
                      ctx.db[evt.data.existingArticle._index].tags = arrayUnion(ctx.db[evt.data.existingArticle._index].tags, evt.data.article.tags)
                      ctx.db.splice(evt.data.article._index, 1)
                    })           
                  },
                  { 
                    cond: (_, evt) => evt.data.existingArticle,
                    target: 'updatingDatabase',
                    actions: immerAssign((ctx, evt) => {
                      ctx.db.splice(evt.data.article._index, 1)
                    })           
                  },
                  { 
                    target: 'updatingDatabase',
                    actions: immerAssign((ctx, evt) => {
                      //Save the article without the _index.
                      ctx.db[evt.data.article._index] = (({ _index, ...rest }) => rest)(evt.data.article)
                    })
                  }
                ]
              }
            },
            savingImages: {
              // 1. Main image
              // 2. Article images
              // 3. Other media? (videos, audio)
              // import { PublicFile } from "odd/fs/v1/PublicFile"

              // const tempFile = await PublicFile.create(
              //   program.components.depot,
              //   pictureBytes // the content
              // )

              // const cid = await tempFile.put()

              // await fs.write(
              //   odd.path.file("public", "pictures", cid.toString()),
              //   pictureBytes
              // )

              // // later
              // await fs.read(
              //   odd.path.file("public", "pictures", cidString)
              // )
            },
            updatingDatabase: {
              invoke: {
                src: (ctx) => writeToFileSystem(ctx.dbPath, JSON.stringify(ctx.db), ctx.fs),
                onDone: {
                  target: 'checkingForUnsavedArticle',
                  actions: [
                    sendParent((ctx) => ({type: 'UPDATE_DATABASE', data: ctx.db})),
                  ]
                },
                onError: {
                  actions: sendParent((_, evt) => createErrorNotification(evt.data))
                }
              }
            },
            articleAlreadyExists: {
              //@TODO: Add tags to existing entry, if they exist
              // entry: send('CHECK_FOR_UNPARSED_ARTICLE'),
              after: {
                500: { target: 'idle' }
              }
            }
          }
        }
      }
    },
    error: {}
  }
})

const service = interpretInWebWorker(fileSystemMachine)
service.start()

// There is a lot of similarity between this and the initiationm process of the file system.
// @todo: make DRY?
const annotationMachine = createMachine({
  // I need to dunamically create the context.
  // XState V5 makes this so much simplier...
  context: {
    url: '',
    fs: null,
    collectionPath: null,
    collection: null
  },
  states: {
    // Use odd exists for URL.
    // If no, go to creatingCollection.
    // If yes, go to loadingCollection
    checkingIfCollectionExists: {
      invoke: {
        src: (ctx) => ctx.fs.exists(ctx.collectionPath),
        onDone: [
            { 
              cond: (_, evt) => !evt.data,
              target: 'creatingCollection'
            },
            { 
              cond: (_, evt) => evt.data,
              target: 'loadingCollection'
            }
        ],
        onError: {
          actions: sendParent((_, evt) => createErrorNotification(evt.data)),
        }
      }
    },
    // On Done, add to context & go to collection ready
    loadingCollection: {
      invoke: {
        src: (ctx) => ctx.fs.get(ctx.collectionPath),
        onDone: {
          actions: [
            assign({ collection: (_, evt) => JSON.parse(uint8ArrayToString(evt.data.content)) }),
            sendParent({ type: 'ANNOTATIONS_INITIATED' })
          ],
          target: 'collectionReady'
        },
        onError: {
          actions: sendParent((_, evt) => createErrorNotification(evt))
        }
      }
    },
    // On Done, add to context & go to collection ready
    creatingCollection: {},
    collectionReady: {
      // On entry, send collection event to FS, which is parent
      states: {
        creatingAnnotation: {},
        savingCollection: {}
      }
    }
  }
})