<script>
  import Tags from "svelte-tags-input"
  export let tagList = []
  export let label = 'Tags'
  export let handleTagging
</script>

<label for={label}>{label}</label>
<Tags 
  id={label}
  on:tags={handleTagging} 
  autoComplete={tagList} 
/>