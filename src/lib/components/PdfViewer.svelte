<script>
  import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'
  const pdfjsWorker = import('pdfjs-dist/build/pdf.worker.entry')

  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

  export let file

  const pdf = async (f) => {
    const res = await pdfjsLib.getDocument(f).promise
    console.log(res)
  }

  $: if (file) {
    console.log(file)
    pdf(file.buffer)
  }
</script>

<p>It's a PDF</p>
