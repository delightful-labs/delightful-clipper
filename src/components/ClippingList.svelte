<script>
  import ClippingListItem from '$components/ClippingListItem.svelte'

  /**
   * @type {import('$lib/schemas/Article').Article[]}
   */
  export let articles

  /**
   * @type {string}
   */
  export let title = ''
  
</script>

<div class="clipping-list">
  <h1>{title}</h1>
  {#if articles.length}
    <ul>
      {#each articles as article}
        <ClippingListItem {article} />
      {/each}
    </ul>
  {:else}
    <p>No articles found</p>
  {/if}
</div>

<style>
  h1 {
    font-size: var(--font-size__xl);
  }

  .clipping-list {
    max-width: var(--width__app);
    margin: 0 auto;
    container-type: inline-size;
  }

  ul {
    margin: 0;
    padding: 0;
    display: grid;
  }

  @container (min-width: 700px) {
    ul {
      grid-template-columns: 1fr 1fr;
    }
  }

</style>