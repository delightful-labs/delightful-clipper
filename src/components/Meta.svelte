<script>
  import MetaItem from '$components/MetaItem.svelte'

  /**
   * @type {*}
   */
  export let metadata
</script>

<div class="meta">
  {#each Object.entries(metadata) as [title, content]}
    <MetaItem {title} {content} />
  {/each}
</div>

<style>
  .meta {
    display: flex;
    flex-wrap: wrap;
    background-image: repeating-linear-gradient(45deg, currentColor, transparent 1px, transparent 10px);
    outline: 1px solid;
  }
</style>