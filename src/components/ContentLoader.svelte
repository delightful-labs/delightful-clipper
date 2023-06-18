<script>
  import { createEventDispatcher } from 'svelte'
  import { mainService } from "$lib/machines/main"
  import { LoadingSpinner } from 'delightful-ui'
  import HTMLRenderer from '@atjson/renderer-html'
  import HTMLSource from "@atjson/source-html"

  export let docContent = null

  export let annotations = []

  let jsonDocWithAnnotations

  $: if (docContent) {
    jsonDocWithAnnotations = { 
      ...docContent,
      annotations: [...docContent.annotations, ...annotations]
    }
  }

  class MyHTMLRenderer extends HTMLRenderer {
    *p() {
      return yield* this.$("p");
    }

    *div() {
      return yield* this.$("div");
    }

    *body() {
      return yield* this.$("body");
    }

    *article() {
      return yield* this.$("article");
    }

    *span() {
      return yield* this.$("span");
    }

    *mark() {
      return yield* this.$("mark");
    }

    *img(embed) {
      return yield* this.$("img", embed.attributes);
    }
  }

  /**
   * @type {import('@oddjs/odd/path/index').FilePath<*>}
   */
  export let filePath

  const dispatch = createEventDispatcher()

  const content = new Promise(res => {
    mainService.subscribe(x => {
      if (x.event.type === 'CONTENT_LOADED') {
        if (JSON.stringify(x.event.data.filePath) === JSON.stringify(filePath)) {

          const body = x.event.data.content.match(/<body[^>]*>[\s\S]*<\/body>/gi)[0]
          const doc = HTMLSource.fromRaw(body).canonical()

          docContent = doc.toJSON()

          // 1. Get raw text of HTML
          // 2. Make new document from raw text
          // 3. Add annotations to new document
          // 4. Merge the original HTML document with the "annotations" document

          res(doc)
          //res(x.event.data.content)
          dispatch('loaded')
        }
      }
    })
  })

  mainService.send({ type: 'LOAD_CONTENT', data: { filePath: filePath }})

</script>

{#await content}
  <LoadingSpinner />
{:then value} 
  <slot name="before-content" />
    {#if docContent}
      {@html MyHTMLRenderer.render(new HTMLSource(jsonDocWithAnnotations) )}
    {:else}
      {@html MyHTMLRenderer.render(value)}
    {/if}
  <slot name="after-content" />
{/await}