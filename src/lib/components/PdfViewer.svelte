<script>
  import PdfPage from '$lib/components/PdfPage.svelte'
  import IntersectionObserver from '$lib/components/IntersectionObserver.svelte'
  import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'
  const pdfjsWorker = import('pdfjs-dist/build/pdf.worker.entry')

  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

  export let file
  let pdf
  let pages
  //@TODO: update averagePageSize when document loads?
  let averagePageSize = {
    width: 500,
    height: 700,
  }

  const getPdf = async (f) => {
    const res = await pdfjsLib.getDocument(f).promise
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
