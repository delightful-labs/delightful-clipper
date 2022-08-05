<script context="module">
	export async function load({ params }) {
		return {
			props: {
				uuid: params.uuid
			}
		}
	}
</script>

<script>
	import { browser } from '$app/env'
	import { userSettings, state } from '$lib/stores'
	import PdfViewer from '$lib/components/PdfViewer.svelte'
	import EpubViewer from '$lib/components/EpubViewer.svelte'

	export let uuid = ''
	let article
	let content

	$: if ($state?.context.db) {
		article = $state.context.db.articles[uuid]
	}

	$: if (browser && article && $state?.context.wn) {
		const getHtml = async () => {
			const path = $state.context.wn.path.file('public', 'Web Pages', article.file)

			//@TODO: only textdecode if is HTML
			content = await $state.context.fs.cat(path).then((bytes) => {
				let text

				if (article.type === 'html') {
					text = new TextDecoder().decode(bytes)
				} else {
					text = bytes
				}

				return text
			})
		}

		getHtml()
	}
</script>

<div
	class="content flow"
	style:font-size="{$userSettings.fontSize}px"
	style:width="{$userSettings.contentWidth}vw"
	style:font-family={$userSettings.fontFamily}
	style:font-weight={$userSettings.fontWeight}
	style:line-height={$userSettings.lineHeight / 10}
>
	{#if article}
		{#await content}
			<p>loading...</p>
		{:then value}
			{#if article.type === 'html'}
				{@html value}
			{:else if article.type === 'html'}
				<PdfViewer file={value} />
			{:else}
				<EpubViewer
					file={value}
					id={uuid}
					currentSectionIndex={article?.readingPosition?.section
						? article?.readingPosition?.section
						: 0}
				/>
			{/if}
		{/await}
	{/if}
</div>

<style lang="scss">
	.content {
		margin: 0 auto;
		flex: 1;

		:global {
			@import '../lib/assets/flow';
		}
	}
</style>
