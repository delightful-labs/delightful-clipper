<script>
  import { userSettings } from '$lib/stores'
  import Meta from '$components/Meta.svelte'
  import ContentLoader from '$components/ContentLoader.svelte'
  import Sentinel from '$components/Sentinel.svelte'

  /** @type {import('./$types').PageData} */ 
  export let data

</script>

<header>
  <h1>{data.title}</h1>
  {#if data.description}
    <p>{data.description}</p>
  {/if}
  <Meta article={data} properties={['author', 'tags']} />
</header>

<div
	class="content flow"
	style:font-size="{$userSettings.fontSize}px"
	style:width="{$userSettings.contentWidth}vw"
	style:font-family={$userSettings.fontFamily}
	style:font-weight={$userSettings.fontWeight}
	style:line-height={$userSettings.lineHeight / 10}
  style:font-variation-settings="'wght' {$userSettings.fontWeight}"
>
  <ContentLoader filePath={data.filePath}>
    <Sentinel on:intersecting={()=> console.log('page ended')} slot="after-content" />
  </ContentLoader>
</div>

<style lang="scss">
  header {
    width: var(--width__app);
    margin: 0 auto;
  }

  .flow {
    margin: 0 auto;

    :global {
			@import '../../../lib/assets/flow';
		}
  }
</style>