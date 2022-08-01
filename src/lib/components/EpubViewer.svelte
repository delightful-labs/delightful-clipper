<script>
	import * as epub from 'epubjs'

	let content = ''
	let currentSectionIndex = 2
	let book

	export let file

	const display = (item) => {
		var section = book.spine.get(item)

		if (section) {
			section.render(book.load.bind(book)).then(function (html) {
				content = html
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
<button on:click={() => currentSectionIndex++}>Next</button>
