<script>
  import { userSettings } from '$lib/stores'
  import Meta from '$components/Meta.svelte'
  import ContentLoader from '$components/ContentLoader.svelte'
  import Sentinel from '$components/Sentinel.svelte'

  /** @type {import('./$types').PageData} */ 
  export let data

  /**
   * @param {Selection} sel
   */
  function isBackwards(sel) {
    var rg = document.createRange()
    rg.setStart(sel.anchorNode, sel.anchorOffset)
    rg.setEnd(sel.focusNode, sel.focusOffset)
    return !rg.toString()
  }

  document.addEventListener("selectionchange", (event) => {
    const selection = window.getSelection()
    // if (selection) {
    //   console.log(isBackwards(selection))
    // }
    const anchor = selection?.anchorNode
    const focus = selection?.focusNode
    const string = selection?.toString()

    //console.log(focus === anchor) 

    if (focus === anchor) {
      const leftover = focus.data.split(string)

      const left_text = focus.data.substring(0, focus.data.indexOf(string))
      const right_text = focus.data.substring(focus.data.indexOf(string) + string?.length)

      console.log(left_text)
      console.log(right_text)
    }

    //console.log()
    //console.log(string)

    // Checks
    // 1. anchor is the same as focus?
    // 2. if so, is there leftover text in the paragraph?
    // 3. if not, is forward or reverse?

    // Possibilities
    // 1. Text is within on paragraph
    // 2. Text is all of one paragraph
    // 3. Text starts with a complete paragraph and ends with a partial paragraph.
    // 4. Text starts with a partial paragraph and ends with a partial paragraph.
    // 5. Text starts with a partial paragraph and ends with a complete paragraph.
    // 6. Text starts with a complete paragraph and ends with a complete paragraph.
  })

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