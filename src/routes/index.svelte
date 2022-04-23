<script>
  import { v4 as uuidv4 } from 'uuid'
  import { db, fissionState, wn, state } from '$lib/stores'

  //TODO: change to store
  let dbFilePath

  const parseArticle = async () => {
    let response = await fetch('/parser', {
      method: 'post',
      body: JSON.stringify({ url: 'https://alistapart.com/article/breaking-out-of-the-box/' }),
    })

    const article = await response.json()

    //console.log([...json.content.matchAll(/<img [^>]*src="([^"]*)"[^>]*>/gm)])

    await $state.context.fs.write($state.context.wn.path.file('public', 'Web Pages', `${article.title}.html`), article.content, { publish: true })

    let { content, ...articleWithoutContent } = article
    articleWithoutContent.html = `${article.title}.html`
    $state.context.db[uuidv4()] = articleWithoutContent
    await $state.context.fs.write($state.context.dbFilePath, $state.context.db, { publish: true })
  }

  const loadImage = async () => {
    let response = await fetch('/loadImage', {
      method: 'post',
      body: JSON.stringify({ url: 'https://i0.wp.com/alistapart.com/wp-content/uploads/2021/12/WindowControlsOverlay.png?fit=1200%2C825&ssl=1&w=640' }),
    })

    const json = await response.json()

    await $state.fs.add(wn.path.file('public', 'Web Pages', 'WindowControlsOverlay.png'), json.blob)
  }

  const flushDb = async () => {
    $db = {}
    await $state.fs.write(dbFilePath, {}, { publish: true })
  }
</script>

<h1>Delightful Clipper</h1>
<button on:click={parseArticle} disabled={!$state.context.wnState}>Parse Article</button>
<button on:click={loadImage} disabled={!$fissionState}>Load Image</button>
<button on:click={flushDb} disabled={!$fissionState}>Flush DB</button>
<a href="/add">Add Article</a>

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
