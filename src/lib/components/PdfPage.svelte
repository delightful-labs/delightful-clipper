<script>
  import { onMount } from 'svelte'

  export let pdf
  export let intersecting
  export let pageNumber
  export let averagePageSize
  let canvas
  let ctx
  let page
  let viewport = averagePageSize

  onMount(() => {
    ctx = canvas.getContext('2d')
  })

  const getPage = async (pdf) => {
    page = await pdf.getPage(pageNumber)
    //@TODO: do some math to make sure that canvas
    //always starts by fitting in browser viewport
    viewport = page.getViewport({ scale: 1 })

    page.render({
      canvasContext: ctx,
      viewport: viewport,
    })
  }

  $: if (pdf?.getPage && intersecting) {
    getPage(pdf)
  }
</script>

<canvas bind:this={canvas} width={viewport ? viewport.width : 0} height={viewport ? viewport.height : 0} />

<style>
  canvas {
    max-width: 100%;
  }
</style>
