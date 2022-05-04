<script>
  import { onMount } from 'svelte'

  export let pdf
  let canvas
  let ctx
  let page
  let viewport

  onMount(() => {
    ctx = canvas.getContext('2d')
  })

  const getPage = async (pdf) => {
    page = await pdf.getPage(1)
    //@TODO: do some math to make sure that canvas
    //always starts by fitting in browser viewport
    viewport = page.getViewport({ scale: 1 })

    page.render({
      canvasContext: ctx,
      viewport: viewport,
    })
  }

  $: if (pdf?.getPage) {
    getPage(pdf)
  }
</script>

<canvas bind:this={canvas} width={viewport ? viewport.width : 0} height={viewport ? viewport.height : 0} />
