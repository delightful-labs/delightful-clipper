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

      content = await $state.context.fs.cat(path).then((bytes) => {
        const text = new TextDecoder().decode(bytes)

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
      {@html value}
    {/await}
  </div>
{/if}

<style>
  div {
    margin: 0 auto;
  }
</style>
