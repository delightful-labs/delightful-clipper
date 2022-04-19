import { createMachine, assign } from 'xstate'

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
    error: undefined
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
              wn: (context, event) => event.data
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
      },
      invoke: {
        src: (context, event) => (send) => {
          context.wn.initialise({ loadFileSystem: false }).then(a => send({type: a.scenario}))

          return;
        }
        // src: (context, event) => context.wn.initialise({ loadFileSystem: false }),
        // onDone: {
        //   target: 'authenticating',
        //   actions: [
        //     (context, event) => console.log(event.data.scenario),
        //     (context, event) => send(event.data.scenario)
        //     // assign({
        //     //   wnState: (context, event) => {
        //     //     switch (event.data.scenario) {
        //     //       case context.wn.Scenario.AuthCancelled:
        //     //         // User was redirected to lobby,
        //     //         // but cancelled the authorisation
        //     //         break
              
        //     //       case context.wn.Scenario.AuthSucceeded:
        //     //       case context.wn.Scenario.Continuation:
        //     //         // ☞ We can now interact with our file system (more on that later)
        //     //         //@TODO              
        //     //         break
              
        //     //       case context.wn.Scenario.NotAuthorised:
        //     //         context.wn.redirectToLobby($fissionState.permissions)
        //     //         break
        //     //     }
        //     //   }
        //     // })
        //   ]
        // },
        // onError: {
        //   target: 'failure',
        //   actions: [
        //     assign({ error: (context, event) => event.data })
        //   ]
        // },
      },
    },
    loadingFs: {
      on: { CONTINUATION: 'initialized'}
      //on: { TOGGLE: 'inactive' }
    },
    initialized: {
      //on: { TOGGLE: 'inactive' }
    },
    failure: [
      
    ]
  }
})

export default mainMachine