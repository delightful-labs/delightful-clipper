<script>
	import { send, state } from '$lib/stores'
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte'

	/**
	 * @type {FileList | null | undefined}
	 */
	let files
	let isEpub = false
	const allowedFileTypes = ['application/epub+zip']

	$: if (files) isEpub = allowedFileTypes.includes(files[0].type)

	/**
	 * @param {FileList | null | undefined} files
	 */
	const upload = (files) =>
		send({
			type: 'UPLOAD_FILE',
			files: files
		})
</script>

{#if $state?.value?.fileSystem?.initialized !== 'idle'}
	<LoadingSpinner />
{:else}
	<form on:submit|preventDefault={() => upload(files)}>
		<input required type="file" id="book" name="book" accept={allowedFileTypes.join()} bind:files />
		<button disabled={!isEpub}>Save File</button>
	</form>
{/if}
