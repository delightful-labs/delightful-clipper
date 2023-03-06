<script>
  //import { mainService } from '$lib/machines/main'
  //import { uint8ArrayToString } from '$lib/files'
  import { userSettings } from '$lib/stores'
  import TagList from '$components/TagList.svelte'
  import Meta from '$components/Meta.svelte'
  import ContentLoader from '$components/ContentLoader.svelte'

  /** @type {import('./$types').PageData} */ 
  export let data

  // /**
	//  * @type {string}
	//  */
  // let html

  // /**
  //  * @param {import('webnative/fs/index').default} fs
  //  */
  // const loadHtml = async (fs) => {
  //   const rawContent = await fs.get(data.filePath)

  //   if (rawContent) {
  //     html = uint8ArrayToString(rawContent.content)
  //   } else {
  //     html = 'Content not processed yet'
  //   }
  // }

  // $: if ($mainService.context.fs) {
  //   loadHtml($mainService.context.fs)
  // }

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
    <Meta>
      <TagList tags={data.tags} />
    </Meta>
  </header>
  <ContentLoader filePath={data.filePath} />
</div>

<style>
  div {
    margin: 0 auto;
  }
</style>