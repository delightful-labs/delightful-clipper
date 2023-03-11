<script>
  import Meta from '$components/Meta.svelte'
  import ArticleOptionsPanel from '$components/ArticleOptionsPanel.svelte'
  
  import { pick } from '$lib/utils'
 
  /**
   * @type {import('$lib/schemas/Article').Article}
   */
  export let article

  //@todo: I might move this into Meta, so it doesn't have to be done each time.
  //Meta could take a list of items to include.
  const filterEmpty = (obj)=>  Object.fromEntries(Object.entries(obj).filter(([_, v]) => v.length))

  let metadata = filterEmpty(pick(article, ['author', 'tags']))

</script>

<li>
  {#if article.title}
    <a href={`/web-pages/${encodeURIComponent(article.url)}`}><h2>{article.title}</h2></a>
  {:else}
    <h2>{article.url}</h2>
  {/if}

  <ArticleOptionsPanel url={article.url} tags={article.tags} />

  <Meta {metadata} />
</li>

<style>
  h2 {
    font-size: var(--font-size__lg);
  }

  li {
    border-top: 1px solid;
    list-style: none;
    padding: var(--spacing__md) 0;
    display: grid;
    gap: var(--spacing__sm);
  }

  li:has(.meta) {
    padding-bottom: 0;
  }
</style>