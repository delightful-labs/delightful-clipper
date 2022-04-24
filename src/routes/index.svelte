<script>
  import { state, send } from '$lib/stores'
  import { isEmpty } from 'ramda'
  import ParseForm from '$components/ParseForm.svelte'

  // const loadImage = async () => {
  //   let response = await fetch('/loadImage', {
  //     method: 'post',
  //     body: JSON.stringify({ url: 'https://i0.wp.com/alistapart.com/wp-content/uploads/2021/12/WindowControlsOverlay.png?fit=1200%2C825&ssl=1&w=640' }),
  //   })

  //   const json = await response.json()

  //   await $state.fs.add(wn.path.file('public', 'Web Pages', 'WindowControlsOverlay.png'), json.blob)
  // }

  // const flushDb = async () => {
  //   $db = {}
  //   await $state.fs.write(dbFilePath, {}, { publish: true })
  // }
</script>

<h1>Delightful Clipper</h1>

<ParseForm />

<!--<a href="/add">Add Article</a>-->

<!--TODO: show different states based on if loading, no articles, etc -->
{#if $state.context?.db && !isEmpty($state.context.db)}
  {#each Object.entries($state.context.db) as [uuid, article]}
    <a href="/{uuid}">
      <h2>{article.title}</h2>
    </a>
  {/each}
{:else}
  <p>No articles</p>
{/if}
