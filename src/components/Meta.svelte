<script>
  import MetaItem from '$components/MetaItem.svelte'
  import { pick } from '$lib/utils'

  /** @type {import('$lib/schemas/Article').Article} */
  export let article

  /** @type {string[]} */
  export let properties = []

  /** @type {*} */
  let metadata = []

  /** @param {object} obj */
  const filterEmpty = (obj)=>  Object.fromEntries(Object.entries(obj).filter(([_, v]) => v.length))

  $: metadata = Object.entries(filterEmpty(pick(article, properties)))

</script>

{#if metadata.length}
  <div class="meta">
    {#each metadata as [title, content]}
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