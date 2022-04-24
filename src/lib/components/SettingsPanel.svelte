<script>
  import { userSettings, state, send } from '$lib/stores'

  const { contentWidth, fontSize } = userSettings

  //await $state.fs.write(dbFilePath, {}, { publish: true })
  const eraseDb = async () => {
    let text = 'Delete database?\nThis cannot be undone'
    if (confirm(text) == true) {
      send('ERASE_DATABASE')
    }
  }
</script>

<details>
  <summary>Settings</summary>
  <!--TODO: line-height, font-family, margins/max-width, dark mode
  Also turn into component-->
  <div class="settings-wrapper">
    <div class="setting-container">
      <label for={'userFontSize'}>Font Size: {$fontSize}px</label>
      <input id={'userFontSize'} type="range" bind:value={$fontSize} min="10" max="48" />
    </div>

    <div class="setting-container">
      <label for={'userContentWidth'}>Content Width: {$contentWidth}%</label>
      <input id={'userContentWidth'} type="range" bind:value={$contentWidth} min="1" max="100" />
    </div>

    <button on:click={eraseDb}>Erase Database</button>
  </div>
</details>

<style>
  details {
    position: relative;
    width: 300px;
  }

  .setting-container {
    display: flex;
    align-items: center;
  }

  .settings-wrapper {
    position: absolute;
    top: 100%;
    background-color: var(--color__background);
    padding: 1rem;
  }
</style>
