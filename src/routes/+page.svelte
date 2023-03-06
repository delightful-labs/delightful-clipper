<script>
  import { mainService } from '$lib/machines/main'
  import ClippingList from '$components/ClippingList.svelte'

  /** @type {import('$lib/schemas/Article').Article[]} */
  let articles = []

  $: articles = $mainService.context.db

</script>

{#if $mainService.value === 'authenticated'}
  <ClippingList {articles} title="All Articles" />
{/if}
