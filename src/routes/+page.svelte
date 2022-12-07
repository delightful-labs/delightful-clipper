<script>
  //import FileWorker from '$lib/filesystem?worker'
  import { fileSystemService } from '$lib/machines/fileSystemMachine'
  import jsonata from 'jsonata'

  //const myWorker = new FileWorker()

  //$: console.log( $fileSystemService )
  const db = $fileSystemService.context.db

  let query = "$$['protocols' in tags]"
  let url = 'https://www.npmjs.com/package/open-graph-scraper'
  let articles = db

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


  const test = {
    "author": "Condé Nast",
    "ogDescription": "In Tuesday’s Senate runoff, one idea about how Trump changed conservatism may hit a dead end.",
    "ogSiteName": "The New Yorker",
    "ogTitle": "Herschel Walker and the Fate of the Right-Wing Celebrity Populist",
    "ogType": "article",
    "ogUrl": "https://www.newyorker.com/news/the-political-scene/herschel-walker-and-the-fate-of-the-right-wing-celebrity-populist",
    "articleSection": "tags",
    "articlePublishedTime": "2022-12-02T19:33:47.365Z",
    "articleModifiedTime": "2022-12-02T19:33:47.365Z",
    "articleAuthor": "Benjamin Wallace-Wells",
    "twitterCard": "summary_large_image",
    "twitterCreator": "@NewYorker",
    "twitterDescription": "In Tuesday’s Senate runoff, one idea about how Trump changed conservatism may hit a dead end.",
    "twitterSite": "@NewYorker",
    "twitterTitle": "Herschel Walker and the Fate of the Right-Wing Celebrity Populist",
    "ogImage": {
        "url": "https://media.newyorker.com/photos/638a2000f7d7848588bd351e/16:9/w_1280,c_limit/BWW-Walker-runoff.jpg",
        "width": null,
        "height": null,
        "type": "jpg"
    },
    "twitterImage": {
        "url": "https://media.newyorker.com/photos/638a2000f7d7848588bd351e/16:9/w_1280,c_limit/BWW-Walker-runoff.jpg?mbid=social_retweet",
        "width": null,
        "height": null,
        "alt": null
    },
    "ogLocale": "en-US",
    "favicon": "https://www.newyorker.com/verso/static/the-new-yorker/assets/favicon.ico",
    "charset": "utf8",
    "requestUrl": "https://www.newyorker.com/news/the-political-scene/herschel-walker-and-the-fate-of-the-right-wing-celebrity-populist",
    "success": true
  }

  //console.log(processMetadata(test))

</script>

<!-- <p>{$fileSystemService.value}</p> -->

<h1>All Articles</h1>

<form on:submit|preventDefault={() => getResponse(url)}>
  <label for="url">URL</label>
  <input 
    id="url" 
    type="url"
    bind:value={url} 
    required={true}
  />
  <input type="submit" />
</form>

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