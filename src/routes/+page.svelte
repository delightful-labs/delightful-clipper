<script>
  //import FileWorker from '$lib/filesystem?worker'
  import { fileSystemService } from '$lib/machines/fileSystemMachine'
  import ClippingList from '$components/ClippingList.svelte';

  //const myWorker = new FileWorker()

  let query = "$$['protocols' in tags]"

  /**
   * @typedef {import('$lib/schemas/Article').Article} Article
   * @type {Article[]}
   */
  let articles = []

  $: articles = $fileSystemService.context.db

  $: console.log(articles)

</script>

<h1>All Articles</h1>

<button on:click={() => fileSystemService.send({type: 'ERASE_DATABASE'})}>Erase Database</button>

{#if articles}
  <ClippingList {articles} />
{:else}
  <p>No articles found</p>
{/if}
