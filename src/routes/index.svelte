<script>
  import * as wn from 'webnative'
  import { browser } from '$app/env'

  let state
  let db

  $: console.log(db)

  const initialiseFission = async () => {
    state = await wn
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
            private: [wn.path.directory('Web Pages')],
            public: [wn.path.directory('Web Pages')],
          },
        },
      })
      .catch((err) => {
        switch (err) {
          case wn.InitialisationError.InsecureContext:
          // We need a secure context to do cryptography
          // Usually this means we need HTTPS or localhost

          case wn.InitialisationError.UnsupportedBrowser:
          // Browser not supported.
          // Example: Firefox private mode can't use indexedDB.
        }
      })

    switch (state.scenario) {
      case wn.Scenario.AuthCancelled:
        // User was redirected to lobby,
        // but cancelled the authorisation
        break

      case wn.Scenario.AuthSucceeded:
      case wn.Scenario.Continuation:
        // State:
        // state.authenticated    -  Will always be `true` in these scenarios
        // state.newUser          -  If the user is new to Fission
        // state.throughLobby     -  If the user authenticated through the lobby, or just came back.
        // state.username         -  The user's username.
        //
        // ☞ We can now interact with our file system (more on that later)
        state.fs

        //Check for DB file and create if missing
        //TODO: turn this into a setIfMissing function
        const dbFilePath = wn.path.file('private', 'Apps', 'Delightful Labs', 'Delightful Clipper', 'db.json')
        const hasDb = await state.fs.exists(dbFilePath)

        if (hasDb) {
          const dbFile = await state.fs.get(dbFilePath)
          db = dbFile
        } else {
          const dbFile = await state.fs.add(dbFilePath, {})
          db = dbFile
        }

        break

      case wn.Scenario.NotAuthorised:
        wn.redirectToLobby(state.permissions)
        break
    }
  }

  $: if (browser) {
    initialiseFission()
  }

  const parseArticle = async () => {
    let response = await fetch('/parser', {
      method: 'post',
      body: JSON.stringify({ url: 'https://alistapart.com/article/breaking-out-of-the-box/' }),
    })

    const json = await response.json()

    console.log([...json.content.matchAll(/<img [^>]*src="([^"]*)"[^>]*>/gm)])

    //await state.fs.add(wn.path.file('public', 'Web Pages', `${json.title}.html`), json.content)

    //TODO: actually save to Fission
  }

  const logArticles = async () => {
    console.log('starting')
    const publicPath = wn.path.directory('public', 'Web Pages')
    const publicLinksObject = await state.fs.ls(publicPath)
    console.log(publicLinksObject)
  }

  const loadImage = async () => {
    let response = await fetch('/loadImage', {
      method: 'post',
      body: JSON.stringify({ url: 'https://i0.wp.com/alistapart.com/wp-content/uploads/2021/12/WindowControlsOverlay.png?fit=1200%2C825&ssl=1&w=640' }),
    })

    const json = await response.json()

    await state.fs.add(wn.path.file('public', 'Web Pages', 'WindowControlsOverlay.png'), json.blob)
  }
</script>

<h1>Delightful Clipper</h1>
<button on:click={parseArticle} disabled={!state}>Parse Artilce</button>
<button on:click={logArticles} disabled={!state}>Log Articles</button>
<button on:click={loadImage} disabled={!state}>Load Image</button>
