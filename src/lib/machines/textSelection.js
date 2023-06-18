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
      after: {
        500: {
          target: 'gettingSelection',
          actions: 'handleSelection'
        }        
      }
    },
    gettingSelection: {
    }
  }
})

export default textSelectionMachine