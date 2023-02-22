<script>
  import { fileSystemService } from '$lib/machines/fileSystemMachine'
  import { uint8ArrayToString } from '$lib/files'
  import SettingsPanel from '$components/SettingsPanel.svelte'
  import { userSettings } from '$lib/stores'

  /** @type {import('./$types').PageData} */ 
  export let data

  
  /**
	 * @type {string}
	 */
  let html

  const loadHtml = async (fs) => {
    const test = await fs.get(data.filePath)
    html = uint8ArrayToString(test.content)
  }

  $: if ($fileSystemService.context.fs) {
    loadHtml($fileSystemService.context.fs)
  }
</script>

<SettingsPanel />

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