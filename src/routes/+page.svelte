<script>
  import { mainService } from '$lib/machines/main'
  import { filteredArticles } from '$lib/stores'
  import ClippingList from '$components/ClippingList.svelte'
  import { LoadingSpinner } from 'delightful-ui'

  /** @type {import('$lib/schemas/Article').Article[]} */
  let articles = []

  $: articles = $mainService.context.db

  $: console.log(articles)

</script>

{#if $mainService.matches('authenticated') }
  {#if $mainService.matches('authenticated.fsReady')}
    <ClippingList articles={$filteredArticles || articles} title={$filteredArticles ? "Filter Results" : "All Articles"} />
  {:else}
    <LoadingSpinner />
  {/if}
{/if}
