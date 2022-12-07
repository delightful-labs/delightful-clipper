import { createMachine, interpret, assign } from 'xstate'
import * as wn from 'webnative'

const articleTemplate = {
  title: 'Noosphere, a protocol for thought',
  url: 'https://subconscious.substack.com/p/noosphere-a-protocol-for-thought',
  image: '',
  tags: ['TfT', 'protocols']
}

const articleTemplate2 = {
  title: 'Wiki as a Commons',
  url: 'https://subconscious.substack.com/p/wiki-as-a-commons',
  image: '',
  tags: ['TfT']
}

const fileSystemMachine = createMachine({
  context: {
    db: [articleTemplate, articleTemplate2],
    dbPath: wn.path.file('private', 'db.json'),
    fs: null
  },
  initial: 'settingUpFs',
  id: 'fs',
  predictableActionArguments: true,
  states: {
    settingUpFs: {
      invoke: {
        src: () => wn.app({ useWnfs: true }),
        onDone: {
          target: 'checkingForDb',
          actions: assign({fs: (_, evt) => evt.data.fs})
        },
        onError: {
          actions: (_, evt) => console.log(evt),
          target: 'error'
        }
      }
    },
    checkingForDb: {
      invoke: {
        src: (ctx) => ctx.fs.exists(ctx.dbPath),
        onDone: [
          { 
            cond: (_, evt) => !evt.data,
            target: 'ready'
          },
          { 
            cond: (_, evt) => evt.data,
            target: 'loadingDb'
          }
        ],
        onError: {
          actions: (c,e) => console.log(e)
        }
      }
    },
    loadingDb: {
      // @TODO: Load DB if it exists
    },
    ready: {
      on: {
        SAVE_ARTICLE: {

        }
      }
    },
    error: {}
  }
})

// Add functions to actions object.

export const fileSystemService = interpret(fileSystemMachine).start()