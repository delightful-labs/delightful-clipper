<script lang="ts">
	import type { WorkflowMessage } from '../contracts/feedback.js'
	import { onMount, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import { Button, Drawer, Heading, Navigation, TopNavigation } from 'delightful-ui'
	import AddLink from './AddLink.svelte'
	import ConnectionStatus from './ConnectionStatus.svelte'
	import { useLibrary } from '../runtime/library-context.js'
	import { action, noun, t } from '../localization/index.js'

	let {
		account,
		children,
		connectionMessage
	}: { account: Snippet; children: Snippet; connectionMessage: WorkflowMessage | undefined } =
		$props()
	const library = useLibrary()
	const id = $props.id()
	const drawerId = `${id}-account`
	let drawerOpen = $state(false)
	let mobile = $state(false)
	const modal = $derived(mobile && drawerOpen)

	onMount(() => {
		const viewport = window.matchMedia('(max-width: 48rem)')
		mobile = viewport.matches
		drawerOpen = !mobile
		const resize = () => {
			mobile = viewport.matches
			drawerOpen = !mobile
		}
		viewport.addEventListener('change', resize)
		return () => viewport.removeEventListener('change', resize)
	})

	function setDrawerOpen(open: boolean) {
		drawerOpen = open
		if (!open) document.getElementById(`${id}-toggle`)?.focus()
	}
</script>

<div class="app-shell">
	<TopNavigation sticky class="clipper-header">
		<Button
			id={`${id}-toggle`}
			type="button"
			appearance="flat"
			aria-label={drawerOpen ? action('close', 'account') : action('show', 'account')}
			aria-controls={drawerId}
			aria-expanded={drawerOpen}
			onclick={() => setDrawerOpen(!drawerOpen)}
			>{drawerOpen ? action('close', 'account') : action('show', 'account')}</Button
		>
		<Heading level="h1" size="lg"><a href="/">{t('app.title')}</a></Heading>
	</TopNavigation>
	<div class="workspace">
		<Drawer
			id={drawerId}
			class="clipper-drawer"
			heading={noun('account')}
			headingHidden
			showCloseButton={false}
			closeLabel={action('close', 'account')}
			bind:open={() => drawerOpen, setDrawerOpen}
		>
			<div class="sidebar-content">
				<Navigation label={t('library.heading')}>
					<li>
						<a
							href="/"
							aria-current={page.url.pathname === '/' ? 'page' : undefined}
							onclick={() => {
								if (mobile) setDrawerOpen(false)
							}}>{t('library.heading')}</a
						>
					</li>
				</Navigation>
				<div class="account-panel">
					<Heading level="h2" size="md">{noun('account')}</Heading>
					{@render account()}
					<ConnectionStatus message={connectionMessage} />
				</div>
			</div>
		</Drawer>
		<main class="content" inert={modal}>
			{@render children()}
			{#if library.actor}{#key library.actor}<AddLink actor={library.actor} />{/key}{/if}
		</main>
		{#if modal}
			<button
				class="drawer-dismiss"
				type="button"
				aria-label={action('close', 'account')}
				onclick={() => setDrawerOpen(false)}
			></button>
		{/if}
	</div>
</div>

<style>
	.app-shell {
		--dui-drawer-height: 100%;
		--dui-drawer-width: 20rem;
		display: grid;
		grid-template-rows: max-content minmax(0, 1fr);
		height: 100dvh;
		overflow: hidden;
	}

	.workspace {
		position: relative;
		display: flex;
		align-items: flex-start;
		min-block-size: 0;
	}

	.sidebar-content {
		display: flex;
		flex-direction: column;
		gap: var(--dui-space-md);
		min-block-size: 100%;
	}

	.account-panel {
		margin-block-start: auto;
	}

	.content {
		flex: 1 1 0%;
		min-inline-size: 0;
		height: 100%;
		overflow: auto;
		padding: var(--dui-space-md);
	}

	.drawer-dismiss {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		inline-size: 3.5rem;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	@media (max-width: 48rem) {
		.app-shell {
			--dui-drawer-width: calc(100vw - 3.5rem);
		}
		.workspace {
			inline-size: 100%;
			min-inline-size: 0;
			overflow-x: clip;
		}
		.content {
			flex: 0 0 100%;
			box-sizing: border-box;
		}
	}
</style>
