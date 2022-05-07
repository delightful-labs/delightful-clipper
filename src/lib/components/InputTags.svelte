<script>
  import Tags from "svelte-tags-input"
  export let tagList = []

  const handleTagging = (evt) => {
    console.log(evt.detail.tags)
  }
</script>

<Tags 
  on:tags={handleTagging} 
  autoComplete={tagList} 
/>