import { createMachine, assign, send } from 'xstate'
import { fromWebWorker } from '$lib/scripts/fromWebWorker'
import fileSystemWorker from '$lib/scripts/fileSystemWorker.js?worker'

//const { permissions } = wn.initialise({ loadFileSystem: false })

//let dbFilePath

//$: if ($wn) dbFilePath = $wn.path.file('private', 'Apps', 'Delightful Labs', 'Delightful Clipper', 'db.json')

// const initialiseFission = async () => {
//   $fissionState = await $wn
//     .initialise({
//       permissions: {
//         // Will ask the user permission to store
//         // your apps data in `prWinampivate/Apps/Nullsoft/`
//         app: {
//           name: 'Delightful Clipper',
//           creator: 'Delightful Labs',
//         },

//         // Ask the user permission to additional filesystem paths
//         fs: {
//           private: [$wn.path.directory('Web Pages')],
//           public: [$wn.path.directory('Web Pages')],
//         },
//       },
//     })
//     .catch((err) => {
//       switch (err) {
//         case $wn.InitialisationError.InsecureContext:
//         // We need a secure context to do cryptography
//         // Usually this means we need HTTPS or localhost

//         case $wn.InitialisationError.UnsupportedBrowser:
//         // Browser not supported.
//         // Example: Firefox private mode can't use indexedDB.
//       }
//     })

//   switch ($fissionState.scenario) {
//     case $wn.Scenario.AuthCancelled:
//       // User was redirected to lobby,
//       // but cancelled the authorisation
//       break

//     case $wn.Scenario.AuthSucceeded:
//     case $wn.Scenario.Continuation:
//       // State:
//       // state.authenticated    -  Will always be `true` in these scenarios
//       // state.newUser          -  If the user is new to Fission
//       // state.throughLobby     -  If the user authenticated through the lobby, or just came back.
//       // state.username         -  The user's username.
//       //
//       // ☞ We can now interact with our file system (more on that later)
//       $fs = $fissionState.fs

//       //Check for DB file and create if missing
//       //TODO: turn this into a setIfMissing function
//       const hasDb = await $fs.exists(dbFilePath)

//       if (hasDb) {
//         const dbFile = await $fs.cat(dbFilePath)
//         $db = dbFile
//       } else {
//         $db = {}
//       }

//       break

//     case $wn.Scenario.NotAuthorised:
//       $wn.redirectToLobby($fissionState.permissions)
//       break
//   }
// }

// $: if (browser && $wn) {
//   initialiseFission()
// }

// onMount(async () => {
//   const wnfs = await import('webnative')
//   $wn = wnfs
// })

const mainMachine = createMachine({
  id: 'main',
  initial: 'uninitialized',
  context: {
    wn: null,
    fs: undefined,
    wnState: undefined,
    dbFilePath: undefined,
    db: {},
    error: undefined,
  },
  states: {
    uninitialized: {
      on: { IN_BROWSER: 'loadingWn' }
    },
    loadingWn: {
      invoke: {
        id: 'loadWn',
        src: (context, event) =>  import('webnative'),
        onDone: {
          target: 'initializingWn',
          actions: [
            assign({
              wn: (context, event) => event.data,
              dbFilePath: (context, event) => event.data.path.file('private', 'Apps', 'Delightful Labs', 'Delightful Clipper', 'db.json'),
            })
          ]
        },
        onError: {
          target: 'failure',
          actions: [
            assign({ error: (context, event) => event.data })
          ]
        }
      },
    },
    initializingWn: {
      on: {
        CONTINUATION: 'initialized',
        AUTH_SUCCEEDED: 'initialized',
        NOT_AUTHORISED: 'unauthorized', //@TODO: figure out logic for this. Probably an idle state.
        AUTH_CANCELLED: 'failure', //@TODO: figure out logic for this
      },
      invoke: {
        src: (context, event) => (send) => context.wn.initialise({ 
          permissions: {
            app: {
              name: 'Delightful Clipper',
              creator: 'Delightful Labs',
            },
            fs: {
              private: [context.wn.path.directory('Web Pages')],
              public: [context.wn.path.directory('Web Pages')],
            },
          },
        }).then(a => {
          send({type: a.scenario, state: a})
        })
        //@TODO: add catch for errors
      },
      exit: assign({
        wnState: (context, event) =>  event.state,
        fs: (context, event) =>  event.state.fs,
        //TODO: Move to invoked promise/callback
        // db: async (context, event) => {
        //     const hasDb = await event.state.exists(context.dbFilePath)
        //     return !hasDb ? await event.state.fs.cat(context.dbFilePath) : {}
        // }   
      })
    },
    unauthorized: {
      on: {
        'AUTHORIZE': {
          target: 'authorizing'
        }
      }
    },
    authorizing: {
      entry: (context) => {
        context.wn.redirectToLobby(context.wnState.permissions)
      }
    },
    initialized: {
      on: { 
        SAVE_ARTICLE: {
          actions: [
            
          ]
        } 
      }
      //entry: send({ type: 'POW' }, { to: 'fileSystem' }),
    },
    failure: {}
  }
})

export default mainMachine