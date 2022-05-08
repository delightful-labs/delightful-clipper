<script>
  import ParseForm from "$lib/components/ParseForm.svelte"
  import { page } from '$app/stores'
  const title = $page.url.searchParams.get('title')
  const url = $page.url.searchParams.get('url')
</script>

<h1>Add Article</h1>
<ParseForm {url} />
