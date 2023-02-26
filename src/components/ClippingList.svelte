<script>
  import ClippingListItem from '$components/ClippingListItem.svelte'

  /**
   * @type {import('$lib/schemas/Article').Article[]}
   */
  export let articles
  
</script>

{#if articles}
  <ul>
    {#each articles as article}
      <ClippingListItem {article} />
    {/each}
  </ul>
{:else}
  <p>No articles found</p>
{/if}

<style>
  ul {
    margin: 0;
    padding: 0;
  }
</style>