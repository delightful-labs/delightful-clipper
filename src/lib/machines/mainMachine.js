import { createMachine, assign, send } from 'xstate'
import { v4 as uuidv4 } from 'uuid'

const mainMachine = createMachine({
  id: 'main',
  initial: 'uninitialized',
  context: {
    wn: null,
    fs: undefined,
    wnState: undefined,
    dbFilePath: undefined,
    db: {},
    error: undefined,
  },
  states: {
    uninitialized: {
      on: { IN_BROWSER: 'loadingWn' }
    },
    loadingWn: {
      invoke: {
        id: 'loadWn',
        src: (context, event) =>  import('webnative'),
        onDone: {
          target: 'initializingWn',
          actions: [
            assign({
              wn: (context, event) => event.data,
              dbFilePath: (context, event) => event.data.path.file('private', 'Apps', 'Delightful Labs', 'Delightful Clipper', 'db.json'),
            })
          ]
        },
        onError: {
          target: 'failure',
          actions: [
            assign({ error: (context, event) => event.data })
          ]
        }
      },
    },
    initializingWn: {
      on: {
        CONTINUATION: 'initialized',
        AUTH_SUCCEEDED: 'initialized',
        NOT_AUTHORISED: 'unauthorized', //@TODO: figure out logic for this. Probably an idle state.
        AUTH_CANCELLED: 'failure', //@TODO: figure out logic for this
      },
      invoke: {
        src: (context, event) => (send) => context.wn.initialise({ 
          permissions: {
            app: {
              name: 'Delightful Clipper',
              creator: 'Delightful Labs',
            },
            fs: {
              private: [context.wn.path.directory('Web Pages')],
              public: [context.wn.path.directory('Web Pages')],
            },
          },
        }).then(a => {
          send({type: a.scenario, state: a})
        })
        //@TODO: add catch for errors
      },
      exit: assign({
        wnState: (context, event) =>  event.state,
        fs: (context, event) =>  event.state.fs,
        //TODO: Move to invoked promise/callback
        // db: async (context, event) => {
        //     const hasDb = await event.state.exists(context.dbFilePath)
        //     return !hasDb ? await event.state.fs.cat(context.dbFilePath) : {}
        // }   
      })
    },
    unauthorized: {
      on: {
        'AUTHORIZE': {
          target: 'authorizing'
        }
      }
    },
    authorizing: {
      entry: (context) => {
        context.wn.redirectToLobby(context.wnState.permissions)
      }
    },
    initialized: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            SAVE_ARTICLE: {
              target: 'savingArticle',
              actions: [
                () => console.log('bye')
                // let response = await fetch('/parser', {
                //   method: 'post',
                //   body: JSON.stringify({ url: 'https://alistapart.com/article/breaking-out-of-the-box/' }),
                // })
            
                // const article = await response.json()
            
                // //console.log([...json.content.matchAll(/<img [^>]*src="([^"]*)"[^>]*>/gm)])
            
                // await $state.context.fs.write($state.context.wn.path.file('public', 'Web Pages', `${article.title}.html`), article.content, { publish: true })
            
                // let { content, ...articleWithoutContent } = article
                // articleWithoutContent.html = `${article.title}.html`
                // $state.context.db[uuidv4()] = articleWithoutContent
                // await $state.context.fs.write($state.context.dbFilePath, $state.context.db, { publish: true })
              ],
            } 
          },
        },
        savingArticle: {
          entry: ()=> console.log('hello')
        }
      }
      //entry: send({ type: 'POW' }, { to: 'fileSystem' }),
    },
    failure: {}
  }
})

export default mainMachine