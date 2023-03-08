<script>
  /**
   * @type {string}
   */
  export let title = ''

  /**
   * @type {string|string[]}
   */
  export let content = ''
</script>

{#if content.length || !content === ''}
  <div class="meta-item">
    {#if title}
      <strong>{title}:</strong>
    {/if}
    {content}
  </div>
{/if}

<style>
  strong {
    flex-shrink: 0;
  }

  .meta-item {
    outline: 1px solid;
    outline-offset: -0.5px;
    padding: var(--spacing__xs);
    display: flex;
    gap: var(--spacing__xs);
    font-size: var(--font-size__sm);
    font-family: var(--font-family__secondary);
    background-color: var(--color__background);
  }
</style>