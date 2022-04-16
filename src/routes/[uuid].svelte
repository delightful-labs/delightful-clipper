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
  import { db, fs, wn, userFontSize, userContentWidth } from '$lib/stores'
  import SettingsPanel from '$lib/components/SettingsPanel.svelte'
  export let uuid
  let article
  let content

  $: if ($db) {
    article = $db[uuid]
  }

  $: if (browser && article && $wn) {
    const getHtml = async () => {
      const path = $wn.path.file('public', 'Web Pages', article.html)

      content = await $fs.cat(path).then((bytes) => {
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
  <article style:font-size="{$userFontSize}px" style:width="{$userContentWidth}vw">
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
