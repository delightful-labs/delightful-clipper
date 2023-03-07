import { assign, createMachine, spawn, send } from "xstate"

const createToastMachine = (options) => createMachine({
  initial: "active",
  context: {
    message: options.message || '',
    type: options.type || ''
  },
  on: {
    MOUSEOVER: {
      target: 'hovering'
    }
  },
  states: {
    active: {
      after: {
        TIMEOUT: {
          target: "inactive",
          actions: ()=> console.log('Dismissing')
        }
      },
      on: {
        DISMISS: {
          target: "inactive",
          actions: ()=> console.log('Dismiss received')
        }
      }
    },
    hovering: {
      on: {
        MOUSELEAVE: {
          target: 'active'
        }
      }
    },
    dismissing: {
      after: {
        TIMEOUT: "inactive"
      }
    },
    inactive: {
      type: "final"
    }
  }
},
{
  delays: {
    TIMEOUT: options.timeout || 3600000 //One Hour
  }
})

export const notifierMachine = createMachine({
  id: "toggle",
  initial: "active",
  context: {
    toasts: []
  },
  states: {
    active: {
      entry: ()=> console.log('notifications system online'),
      on: {
        NOTIFY: {
          actions: assign({
            toasts: (ctx) => {
              return [...ctx.toasts, spawn(createToastMachine({message: 'Something went wrong', type: 'warning', timeout: 2000}))]
            }
          })
        },
        DISMISS: {
          actions: send("DISMISS", {
            to: (ctx, event) => ctx.toasts.find((_, i) => i === event.index)
          })
        }
      }
    }
  }
})