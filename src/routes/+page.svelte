<script>
  import { mainService } from '$lib/machines/mainMachine'
  import ClippingList from '$components/ClippingList.svelte'

  /** @type {import('$lib/schemas/Article').Article[]} */
  let articles = []

  $: articles = $mainService.context.db

</script>

<h1>All Articles</h1>

{#if articles}
  <ClippingList {articles} />
{:else}
  <p>No articles found</p>
{/if}
