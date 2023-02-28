<script>
  import { mainService } from '$lib/machines/mainMachine'
  import { uint8ArrayToString } from '$lib/files'
  import { userSettings } from '$lib/stores'

  /** @type {import('./$types').PageData} */ 
  export let data

  
  /**
	 * @type {string}
	 */
  let html

  mainService.send({ type: 'FETCH_CONTENT', data: data.filePath })

  $: if ($mainService.event.type === 'CONTENT_FETCHED') {
    html = uint8ArrayToString($mainService.event.data)
  }
</script>

<h1>{data.title}</h1>

<div
	class="content flow"
	style:font-size="{$userSettings.fontSize}px"
	style:width="{$userSettings.contentWidth}vw"
	style:font-family={$userSettings.fontFamily}
	style:font-weight={$userSettings.fontWeight}
	style:line-height={$userSettings.lineHeight / 10}
>
  {@html html}
</div>

<style>
  div {
    margin: 0 auto;
  }
</style>