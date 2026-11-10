<script lang="ts">
	import type { WorkflowMessage } from '../contracts/feedback.js'
	import { onMount, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import {
		Button,
		Drawer,
		Heading,
		Icon,
		Navigation,
		NavigationLink,
		StatusMessage
	} from 'delightful-ui'
	import type { ReaderPreferences } from '../reader/schema.js'
	import { setAccountNavigation } from '../runtime/navigation.js'
	import { setAccountSettings } from '../runtime/account-settings.js'
	import AddLink from './AddLink.svelte'
	import ConnectionStatus from './ConnectionStatus.svelte'
	import { useWorkerLibrary } from '../runtime/worker/context.js'
	import { action, noun, t } from '../localization/index.js'

	let {
		account,
		children,
		connectionMessage,
		accountMessage
	}: {
		account: Snippet
		children: Snippet
		connectionMessage: WorkflowMessage | undefined
		accountMessage: WorkflowMessage | undefined
	} = $props()
	setAccountSettings({
		get controls() {
			return account
		}
	})
	const library = useWorkerLibrary()
	const id = $props.id()
	const drawerId = `${id}-account`
	let drawerOpen = $state(false)
	setAccountNavigation({
		get open() {
			return drawerOpen
		}
	})
	let mobile = $state(false)
	let readerFocused = $state(false)
	let theme = $state<ReaderPreferences['theme']>('system')
	$effect(() => {
		const actor = library.actor
		if (!actor) {
			readerFocused = false
			theme = 'system'
			return
		}
		const subscription = actor.subscribe((snapshot) => {
			const view = snapshot.view.readerExperience
			readerFocused = view.focused
			theme = view.preferences.theme
		})
		return () => subscription.unsubscribe()
	})
	$effect(() => {
		if (theme === 'system') document.documentElement.removeAttribute('data-dui-theme')
		else document.documentElement.setAttribute('data-dui-theme', theme)
		return () => document.documentElement.removeAttribute('data-dui-theme')
	})
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

<div class="app-shell" class:focused={readerFocused}>
	{#if !readerFocused}
		<div class="account-control">
			<Button
				class="account-toggle"
				id={`${id}-toggle`}
				type="button"
				aria-label={drawerOpen ? action('close', 'account') : action('show', 'account')}
				aria-controls={drawerId}
				aria-expanded={drawerOpen}
				onclick={() => setDrawerOpen(!drawerOpen)}
			>
				<Icon width="24" height="24">
					{#if drawerOpen}<path d="m6 6 12 12M18 6 6 18" />
					{:else}<path d="M4 6h16M4 12h16M4 18h16" />{/if}
				</Icon>
			</Button>
		</div>
	{/if}
	<div class="workspace">
		{#if !readerFocused}
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
					<div class="drawer-brand">
						<div class="control-spacer" aria-hidden="true"></div>
						<Heading level="h2" size="lg"><a href="/">{t('app.title')}</a></Heading>
					</div>
					<Navigation label={t('library.heading')}>
						<li>
							<NavigationLink
								href="/"
								aria-current={page.url.pathname === '/' ? 'page' : undefined}
								onclick={() => {
									if (mobile) setDrawerOpen(false)
								}}>{t('library.all_articles')}</NavigationLink
							>
						</li>
						<li>
							<NavigationLink
								href="/account"
								aria-current={page.url.pathname === '/account' ? 'page' : undefined}
								onclick={() => {
									if (mobile) setDrawerOpen(false)
								}}>{noun('account')}</NavigationLink
							>
						</li>
					</Navigation>
					<div class="account-panel">
						{#if accountMessage?.text}<StatusMessage {...accountMessage} />{/if}
						<ConnectionStatus message={connectionMessage} />
					</div>
				</div>
			</Drawer>
		{/if}
		<main class="content" inert={modal && !readerFocused}>
			<div class="page-content">{@render children()}</div>
			{#if library.actor && !readerFocused && page.url.pathname === '/'}
				<div class="capture-control">
					{#key library.actor}<AddLink actor={library.actor} />{/key}
				</div>
			{/if}
		</main>
		{#if modal && !readerFocused}
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
		--app-control-size: 44px;
		--app-padding: var(--dui-space-md, 1.5rem);
		--dui-drawer-padding: var(--app-padding);
		--dui-drawer-height: 100%;
		--dui-drawer-width: 20rem;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		min-block-size: 0;
		height: 100dvh;
		overflow: hidden;
	}

	.account-control {
		grid-area: 1 / 1;
		align-self: start;
		justify-self: start;
		position: sticky;
		inset-block-start: var(--app-padding);
		margin: var(--app-padding);
		z-index: 3;
	}

	.account-control :global(.account-toggle) {
		--dui-button-padding: var(--dui-spacing-xs);
		inline-size: var(--app-control-size);
		block-size: var(--app-control-size);
		display: grid;
		place-items: center;
	}

	.drawer-brand {
		display: grid;
		grid-template-columns: var(--app-control-size) minmax(0, 1fr);
		align-items: center;
		gap: var(--dui-spacing-md);
		min-block-size: var(--app-control-size);
	}

	.control-spacer {
		block-size: var(--app-control-size);
	}

	.workspace {
		grid-area: 1 / 1;
		position: relative;
		display: flex;
		align-items: flex-start;
		min-block-size: 0;
		overflow: hidden;
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
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		position: relative;
		box-sizing: border-box;
		min-block-size: 0;
		scrollbar-gutter: stable;
		flex: 1 1 0%;
		min-inline-size: 0;
		height: 100%;
		overflow: auto;
		padding: var(--app-padding);
	}

	.page-content {
		grid-area: 1 / 1;
		min-inline-size: 0;
	}

	.capture-control {
		grid-area: 1 / 1;
		align-self: end;
		position: sticky;
		inset-block-end: 0;
	}

	.content:has(:global(.reader-workspace)) {
		overflow-anchor: none;
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
