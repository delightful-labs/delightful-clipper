<script>
  /**
   * @type {string[]}
   */
  export let tags = []
</script>

{#if tags.length}
  <ul>
    {#each tags as tag}
      <li><a href="/tags/{tag}">{tag}</a></li>
    {/each}
  </ul>
{/if}

<style>
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0;
  }

  li {
    list-style: none;
  }
</style>