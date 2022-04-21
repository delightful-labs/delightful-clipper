import { interpretInWebWorker } from '$lib/scripts/fromWebWorker'
import { createMachine, sendParent, actions } from 'xstate'
import * as wn from 'webnative'

const { log } = actions

const fsMachine = createMachine({
  id: 'fileSystemMachine',
  context: {
    fs: undefined
  },
  initial: 'uninitialized',
  states: {
    uninitialized: {
      on: {
        LOAD_FS: { 
          target: 'initializing',
          actions: (ctx, evt) => console.log(evt)
        },
      },
    },
    initializing: {
      invoke: {
        src: (ctx, evt) => (send) => {
          //wn.loadFileSystem(evt.permissions).then(e=> console.log(e)).catch(e=> console.log(e))
        }
      },
      entry: log('entry')
    },
    initialized: {
      entry: log('init')
    }
  }
})

const service = interpretInWebWorker(fsMachine)
service.start()