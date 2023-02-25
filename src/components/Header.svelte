<script>
	import SettingsPanel from '$components/SettingsPanel.svelte'

	let y = 0
	let lastY = 0
	let hideHeader = false

	const handleScroll = (/** @type {number} */ yPos) => {
		console.log('last:', lastY)
		console.log('current: ', y)
		hideHeader = yPos > lastY
		lastY = yPos
	}
</script>

<svelte:window bind:scrollY={y} on:scroll|trusted={handleScroll(y)} />

<header style:transform="translateY({hideHeader ? '-100%' : '0'})">
	<a href="/">Home</a>
	<a href="/add">Add</a>
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
