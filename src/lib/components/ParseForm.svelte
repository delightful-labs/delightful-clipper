<script>
  import { state, send } from '$lib/stores'
  import { browser } from '$app/env'
  import { trim, isEmpty } from 'ramda'
  import InputTags from '$lib/components/InputTags.svelte'

  let regexUrl =
    /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u00a1-\uffff][a-z0-9\u00a1-\uffff_-]{0,62})?[a-z0-9\u00a1-\uffff]\.)+(?:[a-z\u00a1-\uffff]{2,}\.?))(?::\d{2,5})?(?:[/?#]\S*)?$/i

  export let url = 'https://archive.org/download/whygoduseddlmood00torr_1/whygoduseddlmood00torr_1.pdf'
  let clipboard = ''

  let tagList = []
  let currentTags = []

  const parseArticle = (url) =>
    send({
      type: 'SAVE_ARTICLE',
      url: url,
      tags: currentTags,
      networkStatus: $state.value.network,
    })

  const handleTagging = (evt) => {
    currentTags = evt.detail.tags
  }

  $: if( state?.context?.db ) {
    tagList = state.context.db.tags
  }

  $: console.log(tagList)

  // const checkClipboard = async () => {
  //   const clipboardText = await navigator.clipboard.readText()
  //   const trimmedText = trim(clipboardText)

  //   if (trimmedText.match(regexUrl)) {
  //     clipboard = trimmedText
  //   }
  // }

  // $: if (browser) {
  //   //@TODO: Add check for user interaction
  //   checkClipboard()
  // }
</script>

<form on:submit|preventDefault>
  <div>
    <label for="id">URL</label>
    <input id="url" type="url" bind:value={url} required />
  </div>

  <InputTags {handleTagging} {tagList} />
  <button on:click={() => parseArticle(trim(url))} disabled={!$state.can('SAVE_ARTICLE') || !trim(url).match(regexUrl)}>Parse Article</button>
</form>

<!-- {#if !isEmpty(clipboard)}
  <form on:submit|preventDefault>
    <p>Found {clipboard} from clipboard</p>
    <button on:click={() => parseArticle(trim(clipboard))}>Save from clipboard</button>
  </form>
{/if} -->
