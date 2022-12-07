import { createMachine, interpret, assign } from 'xstate'
import * as webnative from 'webnative'

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
        src: ()=> webnative.app({ useWnfs: false }),
        onDone: [
          {
            cond: (ctx, evt) => evt.data.scenario == webnative.AppScenario.Authed,
            target: 'authenticated',
            actions: assign({ 
              username: (ctx, evt) => evt.data.username,
              fs: (ctx, evt) => evt.data.fs
            })
          },
          {
            cond: (ctx, evt) => evt.data.scenario == webnative.AppScenario.NotAuthed,
            target: 'unauthenticated'
          }
        ],
        onError: [
          {
            cond: (ctx, evt) => evt.data == webnative.InitialisationError.InsecureContext,
            actions: assign({ error: 'Insecure context'}),
            target: 'has_error'
          },
          {
            cond: (ctx, evt) => evt.data == webnative.InitialisationError.UnsupportedBrowser,
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