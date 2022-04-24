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
  import { db, fs, wn, userSettings, state } from '$lib/stores'
  import SettingsPanel from '$lib/components/SettingsPanel.svelte'
  export let uuid
  let article
  let content

  const { contentWidth, fontSize } = userSettings

  $: if ($state?.context.db) {
    article = $state.context.db[uuid]
  }

  $: if (browser && article && $state?.context.wn) {
    const getHtml = async () => {
      const path = $state.context.wn.path.file('public', 'Web Pages', article.html)

      content = await $state.context.fs.cat(path).then((bytes) => {
        const text = new TextDecoder().decode(bytes)

        return text
      })
    }

    getHtml()
  }
</script>

<header>
  <a href="/">Home</a>
  <SettingsPanel />
</header>

{#if article}
  <article style:font-size="{$fontSize}px" style:width="{$contentWidth}vw">
    <h1>{article.title}</h1>
    {#await content}
      <p>loading...</p>
    {:then value}
      {@html value}
    {/await}
  </article>
{/if}

<style>
  article {
    margin: 0 auto;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-self: center;
  }
</style>
