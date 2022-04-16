<script>
  import { userFontSize } from '$lib/stores'
</script>

<details>
  <summary>Settings</summary>
  <!--TODO: line-height, font-family, margins/max-width, dark mode
  Also add labels and display values-->
  <div class="setting-container">
    <label for={'userFontSize'}>Font Size: {$userFontSize}px</label>
    <input id={'userFontSize'} type="range" bind:value={$userFontSize} min="10" max="48" />
  </div>
</details>

<style>
  .setting-container {
    display: flex;
    align-items: center;
  }
</style>
