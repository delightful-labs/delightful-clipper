<script>
  import { userSettings, state, send } from '$lib/stores'
  import DetailsSummary from '$lib/components/DetailsSummary.svelte'

  const { contentWidth, fontSize } = userSettings

  //await $state.fs.write(dbFilePath, {}, { publish: true })
  const eraseDb = async () => {
    let text = 'Delete database?\nThis cannot be undone'
    if (confirm(text) == true) {
      send('ERASE_DATABASE')
    }
  }
</script>

<!--TODO: line-height, font-family, margins/max-width, dark mode
Also turn into component-->
<DetailsSummary title={'Settings'}>
  <div class="setting-container">
    <label for={'userFontSize'}>Font Size: {$fontSize}px</label>
    <input id={'userFontSize'} type="range" bind:value={$fontSize} min="10" max="48" />
  </div>

  <div class="setting-container">
    <label for={'userContentWidth'}>Content Width: {$contentWidth}%</label>
    <input id={'userContentWidth'} type="range" bind:value={$contentWidth} min="1" max="100" />
  </div>

  <button on:click={eraseDb}>Erase Database</button>
  <p>Status: {JSON.stringify($state?.value)}</p>
</DetailsSummary>

<style>
  .setting-container {
    display: flex;
    align-items: center;
  }
</style>
