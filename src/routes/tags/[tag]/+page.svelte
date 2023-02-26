<script>
  import ClippingList from '$components/ClippingList.svelte'

  /** @type {import('./$types').PageData} */ 
  export let data

  const { tag, articles} = data
  
</script>

<h1>Tag: {tag}</h1>

<ClippingList {articles} />
