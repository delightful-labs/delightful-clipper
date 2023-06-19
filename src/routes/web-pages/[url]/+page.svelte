<script>
  import { userSettings } from '$lib/stores'
  import Meta from '$components/Meta.svelte'
  import ContentLoader from '$components/ContentLoader.svelte'
  import Sentinel from '$components/Sentinel.svelte'
	import { mainService } from '$lib/machines/main'
  import textSelectionMachine from '$lib/machines/textSelection'
  import { useMachine } from '@xstate/svelte'
  import * as textPosition from 'dom-anchor-text-position'
  import * as textQuote from 'dom-anchor-text-quote'
  import HTMLSource, { Mark } from "@atjson/source-html"

  /** @type {import('./$types').PageData} */ 
  export let data

  /** @type {number} */
  let ypos = 0

  /**
	 * @type {NodeJS.Timeout | undefined}
	 */
	let timeoutId

  /**
   * 
   * @param {number} pos
   */
  const updateScrollPosition = (pos) => {
    if (timeoutId) clearTimeout(timeoutId)
    const percentage = pos / document.body.scrollHeight
    if (percentage !== data.readPercentage) {
      timeoutId = setTimeout(function () {
        mainService.send({type: 'UPDATE_ARTICLE', data: { url: data.url, readPercentage: percentage }})
      }, 2000)
    }
  }

  const setInitialYPos = () => {
    setTimeout(()=> {
			ypos = data.readPercentage * document.body.scrollHeight
		}, 100)
  }

  let myContent = null

  let annotationDoc

  let annotations

  let contentContainer

  $: if ( myContent ) {
    annotationDoc = HTMLSource.fromRaw(myContent.content)

    annotationDoc.addEventListener("change", () => {
      annotations = annotationDoc.toJSON().annotations
    })
  }

  const handleSelection = () => {
    const range = document.getSelection()?.getRangeAt(0)
    let position = textPosition.fromRange(contentContainer, range)
    //let selector = textQuote.fromTextPosition(contentContainer, position)

    if (annotationDoc) {
      annotationDoc.addAnnotations(
        new Mark ({
          start: position.start - 1,
          end: position.end - 1,
        })
      )
    }
  }

  const { state, send } = useMachine(textSelectionMachine, {
    actions: {
      handleSelection: handleSelection
    }
  })

</script>

<svelte:document on:selectionchange={e => send(e)} />
<svelte:window bind:scrollY={ypos} on:scroll={()=> updateScrollPosition(ypos)} />

<header>
  <h1>{data.title}</h1>
  {#if data.description}
    <p>{data.description}</p>
  {/if}
  <Meta article={data} properties={['author', 'tags']} />
</header>

<div
  bind:this={contentContainer}
	class="content flow"
	style:font-size="{$userSettings.fontSize}px"
	style:width="{$userSettings.contentWidth}vw"
	style:font-family={$userSettings.fontFamily}
	style:font-weight={$userSettings.fontWeight}
	style:line-height={$userSettings.lineHeight / 10}
  style:font-variation-settings="'wght' {$userSettings.fontWeight}"
>
  <ContentLoader 
    filePath={data.filePath} 
    bind:docContent={myContent} 
    bind:annotations={annotations}
    on:loaded={setInitialYPos}
  >
    <Sentinel on:intersecting={()=> console.log('page ended')} slot="after-content" />
  </ContentLoader>
</div>

{#if $state.value === 'hasSelection'}
  <dialog>
    <button on:click={()=> send('CANCEL')}>Cancel</button>
    <button on:click={()=> send('SUBMIT')}>Add highlight</button>
  </dialog>
{/if}

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

  dialog {
    display: block;
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    background-color: var(--color__background);
    padding: var(--spacing__xs);
  }
</style>