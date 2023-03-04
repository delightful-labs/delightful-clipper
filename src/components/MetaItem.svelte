<script>
  /**
   * @type {string}
   */
  export let title = ''
</script>

<div class="meta-item">
  {#if title}
    <strong>{title}:</strong>
  {/if}
  <slot />
</div>

<style>
  strong {
    flex-shrink: 0;
  }

  .meta-item {
    outline: 1px solid;
    padding: 0.5rem;
    display: flex;
    gap: 0.5rem;
    font-size: 0.8rem;
  }
</style>