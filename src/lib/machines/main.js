import { createMachine, interpret, assign, spawn, send } from 'xstate'
import { fromWebWorker } from '$lib/machine-helpers/from-web-worker'
import * as webnative from 'webnative'
import { dev } from '$app/environment'
import FileWorker from '$lib/machines/fileSystem?worker'
import Username from '$lib/schemas/Username'
import { setFullUserName } from '$lib/auth/registration'
import { notifierMachine } from '$lib/machines/notifier'

/**
 * @typedef { import('webnative/fs/index').default } FileSystem
 */

const mainMachine = createMachine({
  predictableActionArguments: true,
  id: 'main',
  context: {
    username: Username.parse({}),
    error: '',
    backupCreated: false,
    authStrategy: null,
    /** @type {Array<import('$lib/schemas/Article').Article>} */
    db: [],
    program: null,
    /**
     * @type null | FileSystem
     */
    fs: null,
    notifier: null
  },
  initial: 'unitialized',
  on: {
    'NOTIFY': {
      actions: send((_, evt) => evt, { to: 'notifier' })
    }
  },
  states: {
    unitialized: {
      entry: assign({ notifier: ()=> spawn(notifierMachine, 'notifier')}),
      invoke: {
        // I don't use wnfs because it will load in worker.s
        src: ()=> webnative.program({ 
          namespace: { creator: "Delightful Labs", name: "Clipper" },
          fileSystem: { loadImmediately: false },
          debug: dev
        }),
        onDone: [
          {
            cond: (_, evt) => evt.data.session,
            target: 'gettingUsername',
            actions: assign({ 
              fs: (_, evt) => evt.data.session.fs,
              authStrategy: (_, evt) => evt.data.auth,
              program: (_, evt) => evt.data
            })
          },
          {
            cond: (_, evt) => !evt.data.session,
            target: 'unauthenticated',
            actions: assign({ 
              authStrategy: (_, evt) => evt.data.auth,
              program: (_, evt) => evt.data
            })
          }
        ],
        onError: [
          {
            cond: (_, evt) => evt.data == webnative.ProgramError.InsecureContext,
            actions: assign({ error: 'Insecure context'}),
            target: 'has_error'
          },
          {
            cond: (_, evt) => evt.data == webnative.ProgramError.UnsupportedBrowser,
            actions: assign({ error: 'Unsupported browser'}),
            target: 'has_error'
          }
        ]
      }
    },
    gettingUsername: {
      invoke: {
        src: (ctx) => ctx.program.components.storage.getItem('fullUsername'),
        onDone: {
          actions: assign({
            username: (ctx, evt) => Username.parse({
              full: evt.data,
              hashed: ctx.program.session.username,
              trimmed: evt.data.split('#')[0],
            })
          }),
          target: 'authenticated'
        },
        onError: {
          actions: (_, evt) => console.error(evt)
        }
      }
    },
    authenticated: {
      //Actor will send update event to parent whenever its state changes
      invoke: {
        id: 'fs',
        src: fromWebWorker(() => new FileWorker()),
      },
      initial: 'settingUpFs',
      states: {
        settingUpFs: {
          on: {
            FILESYSTEM_INITIATED: {
              target: 'fsReady'
            }
          }
        },
        fsReady: {
          on: {
            UPDATE_DATABASE: {
              actions: assign({ db: (_, evt) => evt.data})
            },
            ARTICLE_ALREADY_EXISTS: {
              actions: send({ type: 'NOTIFY', data: { 
                type: 'warning', 
                timeout: 5000, 
                message: 'Article Already Exists' 
              }}, { to: 'notifier' })
            },
            ARTICLE_SAVED: {
              actions: send({ type: 'NOTIFY', data: { 
                type: 'success', 
                timeout: 5000, 
                message: 'Article Saved!' 
              }}, { to: 'notifier' })
            },
            ARTICLE_UPDATED: {
              actions: send({ type: 'NOTIFY', data: { 
                type: 'success', 
                timeout: 5000, 
                message: 'Article Updated!' 
              }}, { to: 'notifier' })
            },
            '*' : {
              cond: (_, evt) => ['DELETE_ARTICLE', 'SAVE_ARTICLE', 'UPDATE_ARTICLE', 'ERASE_DATABASE', 'LOAD_CONTENT'].includes(evt.type),
              actions: send((_, evt) => evt, { to: 'fs' })
            }
          }
        }
      }
    },
    unauthenticated: {
      on: {
        REGISTRATION_SUCCEEDED: {
          target: 'gettingUsername'
        },
        ACCOUNT_LINKED: {
          actions: (ctx, evt) => setFullUserName(evt.data, ctx.program.components.storage).then(x => console.log(x)),
          target: 'unitialized'
        }
      }
    },
    // Only for fatal errors that can't be recovered from, like unsupported browser.
    has_error: {}
  }
})

export const mainService = interpret(mainMachine).start()
