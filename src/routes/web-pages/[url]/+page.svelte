<script>
  import { userSettings } from '$lib/stores'
  import Meta from '$components/Meta.svelte'
  import ContentLoader from '$components/ContentLoader.svelte'
  import Sentinel from '$components/Sentinel.svelte'
  import { useMachine } from '@xstate/svelte'
  import textSelectionMachine from '$lib/machines/textSelection'
  import rssFeedFetcherMachine from '$lib/machines/rssFeedFetcher'
	import { mainService } from '$lib/machines/main'

  /** @type {import('./$types').PageData} */ 
  export let data

  const { state, send } = useMachine(rssFeedFetcherMachine)

  // const { state, send } = useMachine(textSelectionMachine)

  // document.addEventListener("selectionchange", () => {
  //   console.log(window.getSelection()?.toString())
  //   send({ type: 'selectionchange', data: { selection: window.getSelection() }})
  // })

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

</script>

<svelte:window bind:scrollY={ypos} on:scroll={()=> updateScrollPosition(ypos)} />

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
  <ContentLoader filePath={data.filePath} on:loaded={setInitialYPos}>
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