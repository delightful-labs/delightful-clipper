<script>
  //import FileWorker from '$lib/filesystem?worker'
  import { fileSystemService } from '$lib/machines/fileSystemMachine'
  import jsonata from 'jsonata'

  //const myWorker = new FileWorker()

  //$: console.log( $fileSystemService )
  //const db = $fileSystemService.context.db

  let query = "$$['protocols' in tags]"
  let url = 'https://subconscious.substack.com/p/noosphere-a-protocol-for-thought'
  let articles = $fileSystemService.context.db

  $: articles = $fileSystemService.context.db

  const returnResults = (res) => {
    if (!res) {
      return undefined
    } else if (res instanceof Array) {
      return res
    } else {
      return [res]
    }
  }

  const handleSubmit = () => {
    let results = jsonata(query).evaluate(db)
    articles = returnResults(results)
  }

  const getResponse = async (url) => {
    const test = await fetch('/add', { method: 'post', body: JSON.stringify({url: url})})
    const res = await test.json()
    console.log(res)
  }
</script>

<p>{ JSON.stringify( $fileSystemService.value ) }</p>

<h1>All Articles</h1>

<!--@TODO: check if URL is valid and automatically trim whitespace-->
<form on:submit|preventDefault={() => fileSystemService.send({type: 'SAVE_ARTICLE', data: { url: url }})}>
  <label for="url">URL</label>
  <input 
    id="url" 
    type="url"
    bind:value={url} 
    required={true}
  />
  <input type="submit" />
</form>


<!--<form on:submit|preventDefault={() => getResponse(url)}>
  <label for="url">URL</label>
  <input 
    id="url" 
    type="url"
    bind:value={url} 
    required={true}
  />
  <input type="submit" />
</form>-->

<form on:submit|preventDefault={() => handleSubmit()}>
  <label for="query">Query</label>
  <input 
    id="query" 
    type="text"
    bind:value={query} 
  />
  <input type="submit" />
</form>


{#if articles}
  <ul>
    {#each articles as article}
      <li>
        <h2>{article.title}</h2>
      </li>
    {/each}
  </ul>
{:else}
  <p>No articles found</p>
{/if}
