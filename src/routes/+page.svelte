<script>
  //import FileWorker from '$lib/filesystem?worker'
  import { fileSystemService } from '$lib/machines/fileSystemMachine'
  import jsonata from 'jsonata'

  //const myWorker = new FileWorker()

  let query = "$$['protocols' in tags]"
  let url = 'https://subconscious.substack.com/p/noosphere-a-protocol-for-thought'
  let articles = []//$fileSystemService.context.db

  //$: articles = $fileSystemService.context.db

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

  let urlImage = "https://substackcdn.com/image/fetch/w_1200,h_600,c_limit,f_jpg,q_auto:good,fl_progressive:steep/https%3A%2F%2Fbucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com%2Fpublic%2Fimages%2Fcdc9a764-2694-4724-b215-5309455297d7_2792x1566.png"

  //$: console.log($fileSystemService.context)
</script>

<p>{ JSON.stringify( $fileSystemService.value ) }</p>

<h1>All Articles</h1>

<form on:submit|preventDefault={() => fileSystemService.send({type: 'SAVE_IMAGE', data: { url: urlImage }})}>
  <label for="url">Image URL</label>
  <input 
    id="url" 
    type="url"
    bind:value={urlImage} 
    required={true}
  />
  <input type="submit" />
</form>


<!--@TODO: check if URL is valid and automatically trim whitespace. Whitespace trim could actually be done on backend-->
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

<button on:click={() => fileSystemService.send({type: 'ERASE_DATABASE'})}>Erase Database</button>

<!--<form on:submit|preventDefault={() => handleSubmit()}>
  <label for="query">Query</label>
  <input 
    id="query" 
    type="text"
    bind:value={query} 
  />
  <input type="submit" />
</form>-->

{#if articles}
  <ul>
    {#each articles as article}
      <li>
        <h2>{article.title || article.url}</h2>
      </li>
    {/each}
  </ul>
{:else}
  <p>No articles found</p>
{/if}
