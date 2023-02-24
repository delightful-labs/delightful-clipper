<script>
  import Tags from "svelte-tags-input"
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
/>

<style>
  :global(.svelte-tags-input-layout) {
    background: transparent;
  }
</style>