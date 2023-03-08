<script>
  import MetaItem from '$components/MetaItem.svelte'

  /**
   * @type {*}
   */
  export let metadata

  const entries = Object.entries(metadata)
</script>

{#if entries.length}
  <div class="meta">
    {#each entries as [title, content]}
      <MetaItem {title} {content} />
    {/each}
  </div>
{/if}

<style>
  .meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    background-image: repeating-linear-gradient(45deg, currentColor, transparent 1px, transparent 10px);
    outline: 1px solid;
    outline-offset: -0.25px;
  }
</style>