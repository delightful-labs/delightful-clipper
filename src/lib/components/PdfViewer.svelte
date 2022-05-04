<script>
  import PdfPage from './PdfPage.svelte'
  import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'
  const pdfjsWorker = import('pdfjs-dist/build/pdf.worker.entry')

  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

  export let file
  let pdf

  const getPdf = async (f) => {
    const res = await pdfjsLib.getDocument(f).promise
    pdf = res
  }

  $: if (file) {
    getPdf(file.buffer)
  }
</script>

<p>It's a PDF</p>

<PdfPage {pdf} />
