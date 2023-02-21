<script>
  import { fileSystemService } from '$lib/machines/fileSystemMachine'
  import { uint8ArrayToString } from '$lib/files'
  import { onMount } from 'svelte'
  import * as wn from 'webnative'

  /** @type {import('./$types').PageData} */  export let data

  let html

  console.log(data.filePath)

  const loadHtml = async (fs) => {
    const test = await fs.get(data.filePath)
    html = uint8ArrayToString(test.content)
  }

  $: if ($fileSystemService.context.fs) {
    loadHtml($fileSystemService.context.fs)
  }
</script>

<h1>{data.title}</h1>

{@html html}