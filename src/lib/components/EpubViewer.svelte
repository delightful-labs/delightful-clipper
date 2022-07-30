<script>
	import * as epub from 'epubjs'
	import { userSettings } from '$lib/stores'
	import { browser } from '$app/env'

	let rendered = false
	let rendition

	/**
	 * @type {FileList | null | undefined}
	 */
	export let file

	$: if (file) {
		renderBook(file)
	}

	/**
	 * @type {string}
	 */
	let css

	$: if (browser) {
		css = new URL('../assets/flow.css', import.meta.url).href
	}

	const renderBook = (file) => {
		const book = epub.default(file.buffer)
		rendition = book.renderTo('viewer', {
			manager: 'continuous',
			flow: 'scrolled',
			width: '100%',
			height: '100%',
			spread: 'none'
		})

		rendition.themes.register('default', css)
		//rendition.themes.override('text-align', 'right', true)
		//rendition.themes.fontSize($userSettings.fontSize + 'px')
		rendition.display()

		//Can definitely use a state machine to help organize this.
		rendition.on('rendered', () => {
			rendered = true
		})
	}

	$: if ($userSettings.fontFamily && rendered) {
		rendition.themes.font($userSettings.fontFamily)
	}

	$: if ($userSettings.fontSize && rendered) {
		rendition.themes.fontSize($userSettings.fontSize + 'px')
	}

	$: if ($userSettings.fontWeight && rendered) {
		rendition.themes.override('font-weight', $userSettings.fontWeight, true)
	}

	$: if ($userSettings.lineHeight && rendered) {
		rendition.themes.override('line-height', $userSettings.lineHeight / 10, true)
	}

	$: if ($userSettings.contentWidth && rendered) {
		// Types are wrong. Both perameters are optional, but not in types.
		// @ts-ignore
		rendition.resize()
	}
</script>

<div class="wrapper">
	<div id="viewer" style:width="{$userSettings.contentWidth}vw" />
</div>

<style>
	.wrapper {
		display: flex;
		margin: 0 auto;
		min-height: 400px;
	}

	#viewer {
		min-height: 400px;
	}

	/* Override epubjs styles */
	:global(.epub-container) {
		overflow: visible !important;
	}
</style>
