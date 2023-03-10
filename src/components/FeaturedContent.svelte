<div class="featured-content">
  <slot />
</div>

<style>
  .featured-content {
    border: 2px solid;
    box-shadow: 4px 4px;
    padding: var(--spacing__md);
    font-size: var(--font-size__md);
    line-height: 1.2;
    text-align: center;
    display: grid;
    gap: var(--spacing__xs);
  }
</style>