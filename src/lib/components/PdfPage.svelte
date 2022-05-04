<script>
  import { onMount } from 'svelte'
  import LoadingSpinner from '$lib/components/LoadingSpinner.svelte'
  import { log } from 'xstate/lib/actions'

  export let pdf
  export let intersecting
  export let pageNumber
  export let averagePageSize
  let canvas
  let ctx
  let page
  let viewport = averagePageSize
  let loaded = false

  onMount(() => {
    ctx = canvas.getContext('2d')
  })

  const getPage = async (pdf) => {
    page = await pdf.getPage(pageNumber)
    //@TODO: do some math to make sure that canvas
    //always starts by fitting in browser viewport
    viewport = page.getViewport({ scale: 1 })

    await page
      .render({
        canvasContext: ctx,
        viewport: viewport,
      })
      .promise.catch((e) => console.log(e))

    loaded = true
  }

  $: if (pdf?.getPage && intersecting) {
    getPage(pdf)
  }
</script>

<div class="page-wrapper">
  {#if !loaded}
    <div class="placeholder">
      <LoadingSpinner />
    </div>
  {/if}
  <canvas bind:this={canvas} width={viewport ? viewport.width : 0} height={viewport ? viewport.height : 0} />
</div>

<style>
  canvas {
    max-width: 100%;
  }

  .page-wrapper {
    position: relative;
  }

  .placeholder {
    display: grid;
    position: absolute;
    height: 100%;
    width: 100%;
    left: 0;
    top: 0;
    border: 1px solid;
  }
</style>
