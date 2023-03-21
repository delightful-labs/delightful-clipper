<script>
  import { mainService } from '$lib/machines/main'
  import { filteredArticles } from '$lib/stores'
  import ClippingList from '$components/ClippingList.svelte'
  import { LoadingSpinner } from 'delightful-ui'
  import FeaturedContent from '$components/FeaturedContent.svelte'

  /** @type {import('$lib/schemas/Article').Article[]} */
  let articles = []

  $: articles = $mainService.context.db

</script>

{#if $mainService.matches('authenticated') }
  {#if $mainService.matches('authenticated.fsReady')}
    <ClippingList articles={$filteredArticles || articles} title={$filteredArticles ? "Filter Results" : "All Articles"} />
  {:else}
    <LoadingSpinner />
  {/if}
{:else if $mainService.matches('unauthenticated')}
  <FeaturedContent>
    <p>If you are a new user, you can <a href="/register">register</a>.</p>
    <p>If you are an existing user, you can use the device or browser where you are signed in to find the instructions on how to connect this device.</p>
  </FeaturedContent>
{/if}
