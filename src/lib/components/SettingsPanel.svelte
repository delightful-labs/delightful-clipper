<script>
  import { userFontSize, userContentWidth } from '$lib/stores'
</script>

<details>
  <summary>Settings</summary>
  <!--TODO: line-height, font-family, margins/max-width, dark mode
  Also turn into component-->
  <div class="settings-wrapper">
    <div class="setting-container">
      <label for={'userFontSize'}>Font Size: {$userFontSize}px</label>
      <input id={'userFontSize'} type="range" bind:value={$userFontSize} min="10" max="48" />
    </div>

    <div class="setting-container">
      <label for={'userContentWidth'}>Content Width: {$userContentWidth}%</label>
      <input id={'userContentWidth'} type="range" bind:value={$userContentWidth} min="1" max="100" />
    </div>
  </div>
</details>

<style>
  details {
    position: relative;
  }

  .setting-container {
    display: flex;
    align-items: center;
  }

  .settings-wrapper {
    position: absolute;
    top: 100%;
    background-color: canvas;
    padding: 1rem;
  }
</style>
