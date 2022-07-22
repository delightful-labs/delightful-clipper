<script>
  import * as epub from 'epubjs'
  import { userSettings } from '$lib/stores'

  let rendered = false
  let rendition

  /**
  * @type {FileList | null | undefined}
  */
  let files

  $: if (files) {
    renderBook(files[0])
  }


  const renderBook = (file) => {
    const book = epub.default(file)
    rendition = book.renderTo("viewer", {
      manager: "continuous",
      flow: "scrolled",
      width: "100%",
      height: "100%",
      spread: 'none',
    })

    console.log(book)

    rendition.themes.register("default", { "p": { "text-align": "inherit"}})
    //rendition.themes.override('text-align', 'right', true)
    rendition.themes.fontSize($userSettings.fontSize + 'px')
    rendition.display()

    //Can definitely use a state machine to help organize this.
    rendition.on("rendered", ()=> {
      rendered = true
    })
  }

  //$: rendition.themes.fontSize($userSettings.fontSize + 'px')

  $: if ($userSettings.contentWidth && rendered) {
    // Types are wrong. Both perameters are optional, but not in types.
    // @ts-ignore
    rendition.resize()
  }

</script>

<input type="file" id="book" name="book" accept=".epub" bind:files>

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
  .wrapper {
    flex: 1;
    display: flex;
    margin: 0 auto;
  }

  /* Override epubjs styles */
  :global(.epub-container) {
    overflow: auto !important;
    width: 100% !important;
  }
</style>