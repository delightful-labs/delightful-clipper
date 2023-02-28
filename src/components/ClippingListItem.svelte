<script>
  /**
   * @type {import('$lib/schemas/Article').Article}
   */
  export let article
</script>

<li>
  {#if article.title}
    <a href={`/web-pages/${encodeURIComponent(article.url)}`}><h2>{article.title}</h2></a>
  {:else}
    <h2>{article.url}</h2>
  {/if}
  <div>
    {#each article.tags as tag}
      <a href="/tags/{tag}">{tag}</a>
    {/each}
  </div>
</li>

<style>
  li {
    border-top: 1px solid;
    list-style: none;
    padding: 2rem;
  }
</style>