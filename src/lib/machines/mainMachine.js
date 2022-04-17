import { createMachine } from 'xstate'

const mainMachine = createMachine({
  id: 'main',
  initial: 'uninitialized',
  states: {
    uninitialized: {
      on: { IN_BROWSER: 'initializing' }
    },
    initializing: {
      //on: { TOGGLE: 'inactive' }
    },
    initialized: {
      //on: { TOGGLE: 'inactive' }
    },
  }
})

export default mainMachine