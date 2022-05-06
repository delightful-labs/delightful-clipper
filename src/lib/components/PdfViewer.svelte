<script>
  import PdfPage from '$lib/components/PdfPage.svelte'
  import IntersectionObserver from '$lib/components/IntersectionObserver.svelte'
  import * as pdfjsLib from 'pdfjs-dist'

  export let file
  let pdf
  let pages
  //@TODO: update averagePageSize when document loads?
  let averagePageSize = {
    width: 500,
    height: 700,
  }

  const getPdf = async (f) => {
    //@TODO: figure out how to properly load this.
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfWorker.js?worker'
    const res = await pdfjsLib.getDocument({
      data: f,
    }).promise
    pdf = res
  }

  $: if (file) {
    getPdf(file.buffer)
  }

  $: if (pdf) {
    pages = pdf.numPages
  }
</script>

{#if pages}
  {#each Array(pages) as _, index (index)}
    <IntersectionObserver once={true} top={averagePageSize.height * 2} let:intersecting>
      <PdfPage {pdf} {intersecting} pageNumber={index + 1} {averagePageSize} />
    </IntersectionObserver>
  {/each}
{/if}
