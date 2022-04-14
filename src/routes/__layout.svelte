<script>
  import { browser } from '$app/env'
  import { db, fs, state, wn } from '$lib/stores'
  import { onMount } from 'svelte'

  let dbFilePath

  $: if ($wn) dbFilePath = $wn.path.file('private', 'Apps', 'Delightful Labs', 'Delightful Clipper', 'db.json')

  const initialiseFission = async () => {
    $state = await $wn
      .initialise({
        permissions: {
          // Will ask the user permission to store
          // your apps data in `prWinampivate/Apps/Nullsoft/`
          app: {
            name: 'Delightful Clipper',
            creator: 'Delightful Labs',
          },

          // Ask the user permission to additional filesystem paths
          fs: {
            private: [$wn.path.directory('Web Pages')],
            public: [$wn.path.directory('Web Pages')],
          },
        },
      })
      .catch((err) => {
        switch (err) {
          case $wn.InitialisationError.InsecureContext:
          // We need a secure context to do cryptography
          // Usually this means we need HTTPS or localhost

          case $wn.InitialisationError.UnsupportedBrowser:
          // Browser not supported.
          // Example: Firefox private mode can't use indexedDB.
        }
      })

    switch ($state.scenario) {
      case $wn.Scenario.AuthCancelled:
        // User was redirected to lobby,
        // but cancelled the authorisation
        break

      case $wn.Scenario.AuthSucceeded:
      case $wn.Scenario.Continuation:
        // State:
        // state.authenticated    -  Will always be `true` in these scenarios
        // state.newUser          -  If the user is new to Fission
        // state.throughLobby     -  If the user authenticated through the lobby, or just came back.
        // state.username         -  The user's username.
        //
        // ☞ We can now interact with our file system (more on that later)
        $fs = $state.fs

        //Check for DB file and create if missing
        //TODO: turn this into a setIfMissing function
        const hasDb = await $fs.exists(dbFilePath)

        if (hasDb) {
          const dbFile = await $fs.cat(dbFilePath)
          $db = dbFile
        } else {
          $db = {}
        }

        break

      case $wn.Scenario.NotAuthorised:
        $wn.redirectToLobby($state.permissions)
        break
    }
  }

  $: if (browser && $wn) {
    initialiseFission()
  }

  onMount(async () => {
    const wnfs = await import('webnative')
    $wn = wnfs
  })
</script>

<slot />
