import { interpretInWebWorker } from '$lib/scripts/fromWebWorker'
import { createMachine, sendParent, actions } from 'xstate'
import * as wn from 'webnative'

const { log } = actions

const fsMachine = createMachine({
  id: 'fileSystemMachine',
  context: {
    fs: undefined
  },
  on: {
    LOAD_FS: {
      invoke: {
        src: (ctx, evt) => wn.loadFileSystem(evt.data.permissions)
      }
      // actions: [
      //   log((ctx, evt) => evt.permissions),
      //   log('PING'), sendParent('FS_LOADED')
      // ],
    },
  },
})

const service = interpretInWebWorker(fsMachine)
service.start()