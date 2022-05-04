<script>
  import PdfPage from '$lib/components/PdfPage.svelte'
  import IntersectionObserver from '$lib/components/IntersectionObserver.svelte'
  import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'
  const pdfjsWorker = import('pdfjs-dist/build/pdf.worker.entry')

  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

  export let file
  let pdf
  let pages = 0

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

{#each Array(pages) as _, index (index)}
  <IntersectionObserver once={true} let:intersecting>
    <PdfPage {pdf} {intersecting} pageNumber={index + 1} />
  </IntersectionObserver>
{/each}
