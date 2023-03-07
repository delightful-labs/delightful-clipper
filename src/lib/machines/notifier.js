import { assign, createMachine, spawn, send } from "xstate"

const createToastMachine = (ms) => createMachine({
  initial: "active",
  states: {
    active: {
      after: {
        TIMEOUT: {
          target: "inactive",
          actions: ()=> console.log('Dismissing')
        }
      },
      on: {
        DISMISS: "dismissing"
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
    TIMEOUT: ms
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
              return [...ctx.toasts, spawn(createToastMachine(5000))]
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