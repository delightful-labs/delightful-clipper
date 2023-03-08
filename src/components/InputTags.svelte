<script>
  import Tags from "svelte-tags-input"
  /**
   * @type {String[]}
   */
  export let tagList = []
  export let label = 'Tags'

  /**
   * @type {String[]}
   */
  export let tags = []
</script>

<label for={label}>{label}</label>
<Tags 
  bind:tags={tags}
  id={label}
  autoComplete={tagList} 
  onlyUnique={true}
/>

<style>
  :global(.svelte-tags-input-layout) {
    background: transparent !important;
    border: 2px solid currentColor !important;
    border-radius: 0 !important;
    padding: 0 !important;
  }

  :global(.svelte-tags-input-layout:focus-within) {
    outline: none !important;
    border-color: var(--color__actionable) !important;
  }

  :global(.svelte-tags-input) {
    margin-top: 0 !important;
  }

  :global(.svelte-tags-input-tag) {
    margin: 0 0 0 var(--spacing__xs) !important;
    font-family: var(--font-family__secondary) !important;
  }
</style>