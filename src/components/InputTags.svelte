<script>
  import Tags from "svelte-tags-input"
  /**
   * @type {String[]}
   */
  export let tagList = []
  export let label = 'Tags'
  export let handleTagging

  /**
	 * @type {string[]}
	 */
  let tags = []

  $: handleTagging(tags)
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
  }

  :global(.svelte-tags-input-layout:focus-within) {
    outline: none !important;
    border-color: var(--color__actionable) !important;
  }
</style>