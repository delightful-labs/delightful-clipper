<script>
  import { userSettings } from '$lib/stores'
  import Meta from '$components/Meta.svelte'
  import ContentLoader from '$components/ContentLoader.svelte'

  /** @type {import('./$types').PageData} */ 
  export let data

</script>

<div
	class="content flow"
	style:font-size="{$userSettings.fontSize}px"
	style:width="{$userSettings.contentWidth}vw"
	style:font-family={$userSettings.fontFamily}
	style:font-weight={$userSettings.fontWeight}
	style:line-height={$userSettings.lineHeight / 10}
>
  <header>
    <h1>{data.title}</h1>
  </header>
  <ContentLoader filePath={data.filePath} />
</div>

<style>
  div {
    margin: 0 auto;
  }
</style>