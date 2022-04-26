import { createMachine, assign, send } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { browser } from '$app/env'

let initialOnlineStatus = 'online'

if (browser) {
  initialOnlineStatus = navigator.onLine ? 'online' : 'offline'
}

const mainMachine = createMachine({
  id: 'main',
  type: 'parallel',
  context: {
    wn: null,
    fs: undefined,
    wnState: undefined,
    dbFilePath: undefined,
    db: {},
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
            src: (ctx, evt) => (send) => ctx.wn.initialise({ 
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
                  actions: assign((ctx, evt)=> ({db: {...ctx.db, [evt.id]: {url: evt.url}}}))
                },
              },
              invoke: {
                src: (ctx, evt) => (send) => {
                  const isOnline = evt.networkStatus === 'online'
                  const nextEvt = isOnline ? 'PARSE' : 'UPDATE'
                  send({ type: nextEvt,  id: uuidv4(), url: evt.url})
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
              
                  await ctx.fs.write(ctx.wn.path.file('public', 'Web Pages', `${article.title}.html`), article.content, { publish: true })
              
                  let { content, ...articleWithoutContent } = article
    
                  articleWithoutContent.html = `${article.title}.html`
    
                  send({ type: 'SAVE', response: articleWithoutContent, id: evt.id})
                }
              },
              on: {
                SAVE: { 
                  actions: [
                    assign((ctx, evt)=> ({db: {...ctx.db, [evt.id]: evt.response}}))
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
                src: (ctx) => ctx.fs.write(ctx.dbFilePath, {}, { publish: true }),
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