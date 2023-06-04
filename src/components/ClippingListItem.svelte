<script>
  import Meta from '$components/Meta.svelte'
  import ArticleOptionsPanel from '$components/ArticleOptionsPanel.svelte'
 
  /**
   * @type {import('$lib/schemas/Article').Article}
   */
  export let article

</script>

<li>
  <div class="wrapper">

    {#if article._image}
      <img src="{article._image}" alt="{article.imageAlt}" />
    {/if}

    {#if article.title}
      <a href={`/web-pages/${encodeURIComponent(article.url)}`}><h2>{article.title}</h2></a>
    {:else}
      <h2>{article.url}</h2>
    {/if}

    {#if article.description}
      <p>{article.description}</p>
    {/if}

    <footer>
      <ArticleOptionsPanel url={article.url} tags={article.tags} />

      <Meta {article} properties={['author', 'tags']}/>
    </footer>

  </div>
</li>

<style>
  h2 {
    font-size: var(--font-size__lg);
  }

  li {
    container-type: inline-size;
    list-style: none;
  }

  .wrapper {
    border-top: 1px solid;
    padding: var(--spacing__md) 0;
    display: grid;
    gap: var(--spacing__sm);
    grid-auto-columns: max-content;
    grid-template-columns: 1fr;
  }

  @container (min-width: 300px) {
    .wrapper:has(img) {
      grid-template-columns: max-content 1fr;
    }
  }
  

  li:has(.meta) {
    padding-bottom: 0;
  }

  img {
    grid-row: span 2;
    max-width: 200px;
  }

  footer {
    grid-column: 1 / -1;
    display: grid;
    gap: var(--spacing__xs);
  }
</style>