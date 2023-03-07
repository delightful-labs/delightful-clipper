import { assign, createMachine, spawn, send } from "xstate"

const createToastMachine = (options) => createMachine({
  initial: "active",
  context: {
    message: options?.message || '',
    type: options?.type || '',
    timeout: options?.timeout || 3600000,
    timeUsed: 0,
    timerStartTime: 0
  },
  on: {
    MOUSEOVER: {
      actions: assign({ timeUsed: (ctx) => ctx.timeUsed + (Date.now() - ctx.timerStartTime) }),
      target: 'hovering'
    },
    DISMISS: {
      target: "inactive",
      actions: ()=> console.log('Dismiss received')
    }
  },
  states: {
    active: {
      entry: assign({ timerStartTime: () => Date.now() }),
      after: {
        TIMEOUT: {
          target: "inactive",
          actions: ()=> console.log('Dismissing')
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
    TIMEOUT: (ctx) => (options?.timeout || 3600000) - ctx.timeUsed //One Hour
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
            toasts: (ctx, evt) => {
              return [...ctx.toasts, spawn(createToastMachine(evt.data))]
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