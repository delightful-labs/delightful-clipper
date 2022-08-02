<script>
	import * as epub from 'epubjs'
	import { send } from '$lib/stores'

	let content = ''
	let book

	export let file
	export let currentSectionIndex = 0
	export let id = ''

	const display = (item) => {
		var section = book.spine.get(item)

		if (section) {
			section.render(book.load.bind(book)).then(function (html) {
				const text = html.match(/<body>(.|\n)*?<\/body>/)
				if (text) {
					content = text[0]
				} else {
					content = ''
				}
			})
		}
		return section
	}

	const loadBook = async (f) => {
		book = epub.default(f.buffer)

		await book.loaded.navigation

		display(currentSectionIndex)
	}

	$: if (file) {
		loadBook(file)
	}

	$: if (book) {
		display(currentSectionIndex)
	}
</script>

<button on:click={() => currentSectionIndex--}>Prev</button>
{@html content}
<button
	on:click={() =>
		send({
			type: 'UPDATE_POSITION',
			data: { currentSection: currentSectionIndex + 1, id: id }
		})}>Next</button
>
