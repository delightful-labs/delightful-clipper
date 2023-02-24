<script>
	import InputTags from '$components/InputTags.svelte'
  import { fileSystemService } from '$lib/machines/fileSystemMachine'
  import jsonata from 'jsonata'

  let form

	/**
	 * @type {string[]}
	 */
	let tagList = []

  /**
	 * @type {string}
	 */
  let url = ''

	/**
	 * @type {string[]}
	 */
	let currentTags = []

  /**
   * @param {string[]} evt
   */
	const handleTagging = (evt) => {
		currentTags = evt
	}

  const handleSubmit = () => {
    fileSystemService.send({type: 'SAVE_ARTICLE', data: { url: url, tags: currentTags }})
  }

  /**
   * @typedef {import('$lib/schemas/Article').Article} Article
   * @param {Article[]} db
   */
  const findTags = async (db) => {
    tagList = await jsonata(`$distinct([tags])`).evaluate(db)
  }

  $: if ($fileSystemService.context) {
    findTags($fileSystemService.context.db)
  }

</script>

<form on:submit|preventDefault={() => handleSubmit()} bind:this={form}>
		<div>
			<label for="url">URL</label>
			<input name="url" id="url" type="url" bind:value={url} required />
		</div>

		<div>
			<InputTags {handleTagging} {tagList} />
		</div>

		<input type="submit" value="Save Article"/>
</form>
