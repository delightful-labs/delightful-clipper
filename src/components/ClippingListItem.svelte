<script>
  import Meta from '$components/Meta.svelte'
  
  import { pick } from '$lib/utils'
 
  /**
   * @type {import('$lib/schemas/Article').Article}
   */
  export let article

  let metadata = pick(article, ['tags', 'author'])
  
</script>

<li>
  {#if article.title}
    <a href={`/web-pages/${encodeURIComponent(article.url)}`}><h2>{article.title}</h2></a>
  {:else}
    <h2>{article.url}</h2>
  {/if}
  <Meta {metadata} />
</li>

<style>
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