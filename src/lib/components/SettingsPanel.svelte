<script>
  import { userFontSize } from '$lib/stores'
</script>

<div>
  <h2>Settings</h2>
  <input type="range" bind:value={$userFontSize} min="10" max="48" />
</div>
