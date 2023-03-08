<script>
	import SettingsPanel from '$components/SettingsPanel.svelte'
	import { afterNavigate } from "$app/navigation"

	let y = 0
	let lastY = 0
	let hideHeader = false

	afterNavigate(()=> {
		y = 0
		lastY = 0
		hideHeader = false
	})

	const handleScroll = (/** @type {number} */ yPos) => {
		hideHeader = yPos > lastY
		lastY = yPos
	}
</script>

<svelte:window bind:scrollY={y} on:scroll|trusted={handleScroll(y)} />

<header style:transform="translateY({hideHeader ? '-100%' : '0'})">
	<ul>
		<li><a href="/">Home</a></li>
		<li><a href="/add">Add</a></li>
		<li><SettingsPanel /></li>
	</ul>
</header>

<style>
	header {
		background-color: var(--color__background);
		position: sticky;
		top: 0;
		min-height: 48px;
		transition: 400ms;
		border-bottom: 2px solid;
		z-index: 100;
	}

	header :global(.details-content) {
		border-bottom: 2px solid;
	}

	ul {
		display: flex;
		justify-content: space-between;
		align-items: center;
		list-style: none;
		max-width: var(--width__app);
	}
</style>
