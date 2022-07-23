<script>
	import { state, send } from '$lib/stores'

  /**
	 * @type {FileList | null | undefined}
	 */
	let files

  $: if (files) {
		console.log(files[0])
	}

  const upload = (file) =>
		send({
			type: 'UPLOAD_FILE',
			file: file,
		})
</script>

<form on:submit|preventDefault={()=> upload(files[0])}>
  <input 
    required
    type="file" 
    id="book" 
    name="book" 
    accept=".epub" 
    bind:files 
  />
  <button>Save File</button>
</form>