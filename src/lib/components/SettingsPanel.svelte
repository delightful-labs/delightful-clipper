<script>
  import { userFontSize } from '$lib/stores'
</script>

<div>
  <h2>Settings</h2>
  <!--TODO: line-height, font-family, margins/max-width, dark mode
  Also add labels and display values-->
  <input type="range" bind:value={$userFontSize} min="10" max="48" />
</div>
