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
  import * as wn from 'webnative'
  import { browser } from '$app/env'
  import { db, dbFilePath, fs, state } from '$lib/stores'
  export let uuid
  let article
  let content

  $: if ($db) {
    article = $db[uuid]
  }

  $: console.log(content)

  $: if (browser && article) {
    const getHtml = async () => {
      console.log('hello')
      const path = wn.path.file('public', 'Web Pages', article.html)

      content = await $fs.cat(path).then((bytes) => {
        const text = new TextDecoder().decode(bytes)

        return text
      })
    }

    getHtml()
  }
</script>

{#if article}
  <h1>{article.title}</h1>
  <article>
    {#await content}
      <p>loading...</p>
    {:then value}
      {@html value}
    {/await}
  </article>
{/if}
