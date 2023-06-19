import { createMachine, assign } from 'xstate'

const textSelectionMachine = createMachine({
  context: {
    text: '',
    selection: null,
  },
  initial: 'idle',
  id: 'textSelection',
  predictableActionArguments: true,
  on: {
    selectionchange: {
      target: 'debouncing',
    }
  },
  states: {
    idle: {},
    debouncing: {
      entry: [
        assign({ selection: document.getSelection() }),
      ],
      after: {
        500: [
          {
            cond: (ctx) => ctx.selection.toString() != "",
            target: 'hasSelection',
          },
          {
            target: 'idle'
          }
        ]     
      }
    },
    hasSelection: {
      on: {
        CANCEL: {
          target: 'idle'
        },
        SUBMIT: {
          target: 'idle',
          actions: 'handleSelection'
        }
      }
    }
  }
})

export default textSelectionMachine