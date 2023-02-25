<script>
  //import FileWorker from '$lib/filesystem?worker'
  import { fileSystemService } from '$lib/machines/fileSystemMachine'

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
  <ul>
    {#each articles as article}
      <li>
        {#if article.title}
          <a href={`/web-pages/${encodeURIComponent(article.url)}`}><h2>{article.title}</h2></a>
        {:else}
          <h2>{article.url}</h2>
        {/if}
        <div>{article.tags.join(' | ')}</div>
      </li>
    {/each}
  </ul>
{:else}
  <p>No articles found</p>
{/if}
