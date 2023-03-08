<script>
  import TagList from '$components/TagList.svelte'
  import Meta from '$components/Meta.svelte'
  import MetaItem from '$components/MetaItem.svelte'

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
  <Meta>
    {#if article.author}
      <MetaItem title='Author'>
        {article.author}
      </MetaItem>
    {/if}
    {#if article.tags.length}
      <MetaItem title='Tags'>
        <TagList tags={article.tags} />
      </MetaItem>
    {/if}
  </Meta>
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