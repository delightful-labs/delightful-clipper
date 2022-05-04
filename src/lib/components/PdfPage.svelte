<script>
  import { onMount } from 'svelte'

  export let pdf
  let canvas
  let ctx
  let page

  onMount(() => {
    ctx = canvas.getContext('2d')
  })

  const getPage = async (pdf) => {
    page = await pdf.getPage(1)
    let viewport = page.getViewport({ scale: 1 })

    page.render({
      canvasContext: ctx,
      viewport: viewport,
    })
  }

  $: if (pdf?.getPage) {
    getPage(pdf)
  }
</script>

<canvas bind:this={canvas} />
