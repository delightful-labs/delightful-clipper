<script context="module">
  export async function load({ params }) {
    return {
      props: {
        uuid: params.uuid,
      },
    }
  }
</script>

<script>
  import { browser } from '$app/env'
  import { userSettings, state } from '$lib/stores'
  import PdfViewer from '$lib/components/PdfViewer.svelte'

  export let uuid
  let article
  let content

  const { contentWidth, fontSize } = userSettings

  $: if ($state?.context.db) {
    article = $state.context.db[uuid]
  }

  $: if (browser && article && $state?.context.wn) {
    const getHtml = async () => {
      const path = $state.context.wn.path.file('public', 'Web Pages', article.file)

      //@TODO: only textdecode if is HTML
      content = await $state.context.fs.cat(path).then((bytes) => {
        let text

        if (article.type === 'html') {
          text = new TextDecoder().decode(bytes)
        } else {
          text = bytes
        }

        return text
      })
    }

    getHtml()
  }
</script>

{#if article}
  <div style:font-size="{$fontSize}px" style:width="{$contentWidth}vw">
    {#await content}
      <p>loading...</p>
    {:then value}
      {#if article.type === 'html'}
        {@html value}
      {:else}
        <PdfViewer file={value} />
      {/if}
    {/await}
  </div>
{/if}

<style>
  div {
    margin: 0 auto;
  }
</style>
