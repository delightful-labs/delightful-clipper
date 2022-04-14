<script>
  import { v4 as uuidv4 } from 'uuid'
  import { db, fs, state, wn } from '$lib/stores'

  //TODO: change to store
  let dbFilePath

  $: if ($wn) dbFilePath = $wn.path.file('private', 'Apps', 'Delightful Labs', 'Delightful Clipper', 'db.json')

  const parseArticle = async () => {
    let response = await fetch('/parser', {
      method: 'post',
      body: JSON.stringify({ url: 'https://alistapart.com/article/breaking-out-of-the-box/' }),
    })

    const article = await response.json()
    //console.log(article)

    //console.log([...json.content.matchAll(/<img [^>]*src="([^"]*)"[^>]*>/gm)])

    await $fs.write(wn.path.file('public', 'Web Pages', `${article.title}.html`), article.content, { publish: true })

    let { content, ...articleWithoutContent } = article
    articleWithoutContent.html = `${article.title}.html`
    $db[uuidv4()] = articleWithoutContent
    await $fs.write(dbFilePath, $db, { publish: true })
  }

  const loadImage = async () => {
    let response = await fetch('/loadImage', {
      method: 'post',
      body: JSON.stringify({ url: 'https://i0.wp.com/alistapart.com/wp-content/uploads/2021/12/WindowControlsOverlay.png?fit=1200%2C825&ssl=1&w=640' }),
    })

    const json = await response.json()

    await $fs.add(wn.path.file('public', 'Web Pages', 'WindowControlsOverlay.png'), json.blob)
  }

  const flushDb = async () => {
    $db = {}
    await $fs.write(dbFilePath, {}, { publish: true })
  }
</script>

<h1>Delightful Clipper</h1>
<button on:click={parseArticle} disabled={!$state}>Parse Artilce</button>
<button on:click={loadImage} disabled={!$state}>Load Image</button>
<button on:click={flushDb} disabled={!$state}>Flush DB</button>

<!--TODO: show different states based on if loading, no articles, etc -->
{#if $db}
  {#each Object.entries($db) as [uuid, article]}
    <a href="/{uuid}">
      <h2>{article.title}</h2>
    </a>
  {/each}
{:else}
  <p>No articles</p>
{/if}
