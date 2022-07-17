<script>
  import * as epub from 'epubjs'
  import { userSettings } from '$lib/stores'

  let rendered = false

  const book = epub.default("https://s3.amazonaws.com/epubjs/books/moby-dick/OPS/package.opf")
  const rendition = book.renderTo("viewer", {
    width: "100%",
    height: "100%",
    spread: 'none',
  })

  rendition.themes.fontSize('32px')
  rendition.display()

  rendition.on("rendered", ()=> {
    rendered = true
  })

  $: rendition.themes.fontSize($userSettings.fontSize + 'px')

  $: if ($userSettings.contentWidth && rendered) {
    // @ts-ignore
    rendition.resize()
  }

  console.log(rendition)

</script>

<button on:click={()=> rendition.prev()}>‹</button>
<div class="wrapper">
  <div 
    id="viewer" 
    style:width="{$userSettings.contentWidth}vw"
    >
  </div>
</div>
<button on:click={()=> rendition.next()}>›</button>

<style>
  #viewer {
    
  }

  .wrapper {
    flex: 1;
    display: flex;
    margin: 0 auto;
  }
</style>