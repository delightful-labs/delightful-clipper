import { createMachine, assign, send } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { browser } from '$app/env'

let initialOnlineStatus = 'online'

const dbTemplate = {
  tags: [],
  articles: {}
}

if (browser) {
  initialOnlineStatus = navigator.onLine ? 'online' : 'offline'
}

const htmlTemplate = (content) => `<html>
  <head>
    ${ content.title ? `<meta property="og:title" content="${content.title}" />` : ''}
    ${ content.description ? `<meta property="og:description" content="${content.description}"/>` : ''}
    ${ content.image ? `<meta property="og:image" content="${content.image}"/>` : ''}
    ${ content.url ? `<meta property="og:url" content="${content.url}"/>` : ''}
    ${ content.published ? `<meta property="article:published_time" content="${content.published}"/>` : ''}
    ${ content.author ? `<meta property="article:author" content="${content.author}"/>` : ''}
    <meta property="og:type" content="article"/>
  </head>
  <body>
    <article>
      <h1>${content.title}</h1>
      ${content.content}
    </article>
  </body>
</html>`

const mainMachine = createMachine({
  id: 'main',
  type: 'parallel',
  context: {
    wn: null,
    fs: undefined,
    wnState: undefined,
    dbFilePath: undefined,
    db: dbTemplate,
    error: undefined,
  },
  states: {
    fileSystem: {
      initial: 'uninitialized',
      states: {
        uninitialized: {
          on: { IN_BROWSER: 'loadingWn' }
        },
        loadingWn: {
          invoke: {
            id: 'loadWn',
            src: () =>  import('webnative'),
            onDone: {
              target: 'initializingWn',
              actions: [
                assign({
                  wn: (ctx, evt) => evt.data,
                  dbFilePath: (ctx, evt) => evt.data.path.file('private', 'Apps', 'Delightful Labs', 'Delightful Clipper', 'db.json'),
                })
              ]
            },
            onError: {
              target: 'failure',
              actions: [
                assign({ error: (ctx, evt) => evt.data })
              ]
            }
          },
        },
        initializingWn: {
          on: {
            CONTINUATION: 'checkingForDb',
            AUTH_SUCCEEDED: 'checkingForDb',
            NOT_AUTHORISED: 'unauthorized',
            AUTH_CANCELLED: 'unauthorized',
          },
          invoke: {
            src: (ctx) => (send) => ctx.wn.initialise({ 
              permissions: {
                app: {
                  name: 'Delightful Clipper',
                  creator: 'Delightful Labs',
                },
                fs: {
                  private: [ctx.wn.path.directory('Web Pages')],
                  public: [ctx.wn.path.directory('Web Pages')],
                },
              },
            }).then(a => {
              send({type: a.scenario, state: a})
            })
            //@TODO: add catch for errors
          },
          exit: assign({
            wnState: (ctx, evt) =>  evt.state,
            fs: (ctx, evt) =>  evt.state.fs, 
          })
        },
        checkingForDb: {
          on: {
            FOUND_DB: {
              target: 'loadingDb'
            },
            NO_DB: {
              target: 'initialized'
            }
          },
          invoke: {
            src: (ctx) => (send) => ctx.fs.exists(ctx.dbFilePath)
              .then(e => send(e ? 'FOUND_DB' : 'NO_DB'))
          }
        },
        loadingDb: {
          invoke: {
            src: (ctx) => ctx.fs.cat(ctx.dbFilePath),
            onDone: {
              actions: assign({
                db: (ctx, evt) => evt.data
              }),
              target: 'initialized'
            }
          }
        },
        unauthorized: {
          on: {
            'AUTHORIZE': {
              target: 'authorizing'
            }
          }
        },
        authorizing: {
          entry: (ctx) => {
            ctx.wn.redirectToLobby(ctx.wnState.permissions)
          }
        },
        initialized: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                ERASE_DATABASE: {
                  target: 'erasingDatabase'
                },
                SAVE_ARTICLE: {
                  target: 'creatingEntry'
                }
              },
            },
            creatingEntry: {
              on: {
                PARSE: {
                  target: 'parsingArticle',
                },
                UPDATE: {
                  target: 'updatingDatabase',
                  actions: assign((ctx, evt)=> ({db: {
                    ...ctx.db,
                    tags: [...new Set([...ctx.db.tags,...evt.tags])],
                    articles: {
                      ...ctx.db.articles,
                      [evt.id]: {url: evt.url}
                    }
                  }}))
                },
              },
              invoke: {
                src: (ctx, evt) => (send) => {
                  const isOnline = evt.networkStatus === 'online'
                  const nextEvt = isOnline ? 'PARSE' : 'UPDATE'
                  send({ 
                    type: nextEvt,  
                    id: uuidv4(), 
                    url: evt.url,
                    tags: evt.tags
                  })
                }
              }
            },
            parsingArticle: {
              invoke: {
                src: (ctx, evt) => async (send) => {
                  let response = await fetch('/parser', {
                    method: 'post',
                    body: JSON.stringify({ url: evt.url }),
                  })
              
                  const article = await response.json()
              
                  //console.log([...json.content.matchAll(/<img [^>]*src="([^"]*)"[^>]*>/gm)])

                  const prepareFile = (x) => x.type === 'html' ? htmlTemplate(x) : Uint8Array.from(Object.values(x.content))
              
                  await ctx.fs.write(ctx.wn.path.file('public', 'Web Pages', `${article.title}.${article.type}`), prepareFile(article), { publish: true })
              
                  let { content, ...articleWithoutContent } = article
    
                  articleWithoutContent.file = `${article.title}.${article.type}`
    
                  send({ type: 'SAVE', response: articleWithoutContent, id: evt.id})
                }
              },
              on: {
                SAVE: { 
                  actions: [
                    assign((ctx, evt)=> ({db: {
                      ...ctx.db, 
                      articles: {
                        ...ctx.db.articles,
                        [evt.id]: evt.response}
                    }}))
                  ],
                  target: 'updatingDatabase'
                }
              }
            },
            updatingDatabase: {
              invoke: {
                src: (ctx) => ctx.fs.write(ctx.dbFilePath, ctx.db, { publish: true }),
                onDone: {
                  target: 'idle'
                }
              },
            },
            erasingDatabase: {
              invoke: {
                src: (ctx) => ctx.fs.write(ctx.dbFilePath, dbTemplate, { publish: true }),
                onDone: {
                  target: 'idle'
                }
              },
            }
          }
        },
        failure: {}
      }
    },
    network: {
      initial: initialOnlineStatus,
      states: {
        online: {
          on: {
            OFFLINE: { target: 'offline' },
          }
        },
        offline: {
          on: {
            ONLINE: { target: 'online' },
          }
        }
      }
    }
  }
})

export default mainMachine