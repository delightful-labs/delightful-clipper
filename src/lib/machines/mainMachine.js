import { createMachine, interpret, assign } from 'xstate'
import * as webnative from 'webnative'
import { dev } from '$app/environment'

/**
 * @typedef { import('webnative/fs/index').default } FileSystem
 */

const mainMachine = createMachine({
  predictableActionArguments: true,
  id: 'main',
  context: {
    username: '',
    error: '',
    backupCreated: false,
    authStrategy: null,
    /**
     * @type null | FileSystem
     */
    fs: null
  },
  initial: 'unitialized',
  states: {
    unitialized: {
      invoke: {
        // I don't use wnfs because it will load in worker.s
        src: ()=> webnative.program({ 
          namespace: { creator: "Delightful Labs", name: "Clipper" },
          fileSystem: {
            loadImmediately: false
          },
          debug: dev
        }),
        onDone: [
          {
            cond: (_, evt) => evt.data.session,
            target: 'authenticated',
            actions: assign({ 
              username: (_, evt) => evt.data.username,
              fs: (_, evt) => evt.data.fs
            })
          },
          {
            cond: (_, evt) => !evt.data.session,
            target: 'unauthenticated',
            actions: assign({ 
              authStrategy: (_, evt) => evt.data.auth
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
    authenticated: {

    },
    registering: {
      on: {
        REGISTRATION_CANCELLED: {
          target: 'unauthenticated'
        },
        REGISTRATION_SUCCEEDED: {
          target: 'authenticated'
        }
      }
    },
    unauthenticated: {
      on: {
        REGISTER: {
          target: 'registering'
        }
      }
    },
    // Only for fatal errors that can't be recovered from, like unsupported browser.
    has_error: {}
  }
})

export const mainService = interpret(mainMachine).start()
