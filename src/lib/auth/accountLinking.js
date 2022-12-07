import { createMachine, assign, sendParent } from 'xstate'

// @TODO: Setup `callback` and `returns` to be correct
/**
 * Creates an XState machine that starts up a WNFS listener.
 * @param {string} username 
 * @param {*} callback 
 * @returns function
 */
export const createListenerMachine = (username, callback) => createMachine({
  id: 'listener',
  initial: 'settingUp',
  predictableActionArguments: true,
  context: {
    listener: null,
  },
  on: {
    CANCEL: {
      target: 'cancelled',
      actions: [
        () => console.log('cancelled'),
        (ctx) => ctx.listener.cancel()
      ]
    },
    // Forward all other events to parent.
    '*': { actions: [
      (c,e) => console.log(e),
      sendParent((_, evt) => evt) 
    ]},
  },
  states: {
    settingUp: {
      invoke: {
        src: () => callback({ username: username }),
        onDone: {
          target: 'listening', 
          actions: assign({listener: (_, evt) => evt.data})
        },
        onError: {
          target: 'error'
        }
      }
    },
    listening: {
      invoke: {
        src: (ctx) => (sendBack) => {
          if (ctx.listener) {
            ctx.listener.on('challenge', detail => {
              console.log('challenge')
              sendBack({type: 'CHALLENGE', data: detail})
            })
  
            ctx.listener.on('link', detail => {
              sendBack({ type: 'LINK', data: detail})
            })

            ctx.listener.on('done', detail => {
              console.log('Listener is done')
              sendBack({ type: 'DONE', data: detail})
            })
          }
        }
      }
    },
    cancelled: {
      type: 'final'
    },
    error: {
      type: 'final'
    } // @TODO: Send error message.
  }
})