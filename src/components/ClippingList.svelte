<script>
  import ClippingListItem from '$components/ClippingListItem.svelte'

  /**
   * @typedef {import('$lib/schemas/Article').Article} Article
   * @type {Article[]}
   */
  export let articles
</script>

<ul>
  {#each articles as article}
    <ClippingListItem {article} />
  {/each}
</ul>

<style>
  ul {
    margin: 0;
    padding: 0;
  }
</style>