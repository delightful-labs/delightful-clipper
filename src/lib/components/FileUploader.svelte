<script>
	import { send } from '$lib/stores'

	/**
	 * @type {FileList | null | undefined}
	 */
	let files

	/**
	 * @param {FileList | null | undefined} files
	 */
	const upload = (files) =>
		send({
			type: 'UPLOAD_FILE',
			files: files
		})
</script>

<form on:submit|preventDefault={() => upload(files)}>
	<input required type="file" id="book" name="book" accept=".epub" bind:files />
	<button>Save File</button>
</form>
