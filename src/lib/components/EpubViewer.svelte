<script>
	import * as epub from 'epubjs'
	import { send, readingPosition } from '$lib/stores'
	import { onMount } from 'svelte'

	let content = ''
	let book

	export let file
	export let currentSectionIndex = 0
	export let id = ''
	export let ypos = 0

	/**
	 * @type {NodeJS.Timeout | undefined}
	 */
	let timeoutId

	const updateScrollPosition = (/** @type {number} */ pos) => {
		if ($readingPosition !== pos) {
			if (timeoutId) clearTimeout(timeoutId)
			const percentage = pos / document.body.scrollHeight
			timeoutId = setTimeout(function () {
				send({
					type: 'UPDATE_SCROLL',
					data: { currentPercentage: percentage, id: id }
				})
			}, 2000)
		}
	}

	const display = async (item) => {
		var section = book.spine.get(item)

		if (section) {
			section.render(book.load.bind(book)).then(function (html) {
				const text = html.match(/<body(.|\n)*?<\/body>/)
				if (text) {
					content = text[0]
				} else {
					content = ''
				}
			})
		}

		//Could split out into a function
		const savedPos = $readingPosition * document.body.scrollHeight
		if (savedPos !== ypos) {
			setTimeout(function () {
				ypos = savedPos
			}, 100)
		}

		return section
	}

	const loadBook = async (f) => {
		book = epub.default(f.buffer)

		await book.loaded.navigation

		await display(currentSectionIndex)
	}

	const updatePosition = (/** @type {number} */ pos) => {
		const newPos = currentSectionIndex + pos
		send({
			type: 'UPDATE_POSITION',
			data: { currentSection: newPos, id: id }
		})
	}

	onMount(() => loadBook(file))

	//@TODO: Make a part of onMount?
	//Or not because it needs to run each time the section changes
	$: if (book) {
		display(currentSectionIndex)
	}
</script>

<svelte:window bind:scrollY={ypos} on:scroll={updateScrollPosition(ypos)} />

<button on:click={() => updatePosition(-1)} disabled={currentSectionIndex == 0}>Prev</button>
{@html content}
<button on:click={() => updatePosition(1)}>Next</button>
