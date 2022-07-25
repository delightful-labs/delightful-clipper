<script>
	import ParseForm from '$lib/components/ParseForm.svelte'
	import SettingsPanel from '$lib/components/SettingsPanel.svelte'
	import DetailsSummary from '$lib/components/DetailsSummary.svelte'
	import { log } from '$lib/stores'

	let y = 0
	let lastY = 0
	let hideHeader = true

	const handleScroll = (/** @type {number} */ yPos) => {
		hideHeader = yPos > lastY
		lastY = yPos
	}

	$: handleScroll(y)
</script>

<svelte:window bind:scrollY={y} />

<header style:transform="translateY({hideHeader ? '-100%' : '0'})">
	<a href="/">Home</a>
	<DetailsSummary title={'Add'}>
		<ParseForm />
	</DetailsSummary>
	<DetailsSummary title={'Log'}>
		<ol>
			{#each $log as entry}
				<li>{entry.time} | {entry.title}</li>
			{/each}
		</ol>
	</DetailsSummary>
	<SettingsPanel />
</header>

<style>
	header {
		background-color: var(--color__background);
		position: sticky;
		top: 0;
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 48px;
		transition: 400ms;
		border-bottom: 2px solid;
		z-index: 100;
	}

	header :global(.details-content) {
		border-bottom: 2px solid;
	}
</style>
