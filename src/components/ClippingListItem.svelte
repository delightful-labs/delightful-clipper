<script>
  import Meta from '$components/Meta.svelte'
  import ArticleOptionsPanel from '$components/ArticleOptionsPanel.svelte'
 
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

  {#if article.description}
    <p>{article.description}</p>
  {/if}

  <ArticleOptionsPanel url={article.url} tags={article.tags} />

  <Meta {article} properties={['author', 'tags']}/>
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