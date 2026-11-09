<script lang="ts">
	import { Button, Drawer, Heading, Icon, StatusMessage } from 'delightful-ui'
	import { onMount } from 'svelte'
	import PageNavigation from '../navigation/PageNavigation.svelte'
	import type { ImageView } from '../../images/view-machine.js'
	import type { AssetResult } from '../../contracts/storage.js'
	import type { WorkflowMessage } from '../../contracts/feedback.js'
	import type { ReaderPreferences, ReaderChange } from '../../reader/schema.js'
	import type { ReaderHeading, ReaderFootnote } from '../../reader/structure.js'
	import { t } from '../../localization/index.js'
	import SavedContent from '../../integrations/SavedContent.svelte'
	import ReaderToolbar from './ReaderToolbar.svelte'
	import ReaderActions from './ReaderActions.svelte'
	import FootnotePreview from './FootnotePreview.svelte'
	let {
		title,
		asset,
		imageViews = {},
		onretryimage,
		onimageerror,
		text,
		sourceUrl,
		preferences,
		progress,
		focused,
		enabled,
		canOrganize,
		trashed,
		archived,
		headings,
		footnote,
		footnoteId,
		message,
		readingMessage,
		onchange,
		onfocus,
		onshowcontrols,
		onreflow,
		onarchive,
		onrestore,
		onready,
		onrelease,
		onlink,
		onfullnote,
		onfootnoteclose
	}: {
		title: string
		asset: AssetResult
		imageViews?: Record<string, ImageView>
		onretryimage?: (url: string) => void
		onimageerror?: ((id: string, url: string) => void) | undefined
		text: string
		sourceUrl: string | undefined
		preferences: ReaderPreferences
		progress: number | undefined
		focused: boolean
		enabled: boolean
		canOrganize: boolean
		trashed: boolean
		archived: boolean
		headings: ReaderHeading[]
		footnote: ReaderFootnote | undefined
		footnoteId: string
		message: WorkflowMessage | undefined
		readingMessage: WorkflowMessage | undefined
		onchange: (change: ReaderChange) => void
		onfocus: () => void
		onshowcontrols: () => void
		onreflow: () => void
		onarchive: () => void
		onrestore: () => void
		onready: (node: HTMLElement) => void
		onrelease: () => void
		onlink: (event: MouseEvent, node: HTMLElement) => void
		onfullnote: () => void
		onfootnoteclose: () => void
	} = $props()
	const focusId = $props.id()
	let previousFocus = false
	let drawerOpen = $state(false)
	let mobile = $state(false)
	const drawerId = `${focusId}-settings`
	const drawerModal = $derived(mobile && drawerOpen && !focused)
	onMount(() => {
		const viewport = window.matchMedia('(max-width: 48rem)')
		mobile = viewport.matches
		drawerOpen = !mobile
		const resize = () => {
			mobile = viewport.matches
		}
		viewport.addEventListener('change', resize)
		return () => viewport.removeEventListener('change', resize)
	})

	function setDrawerOpen(open: boolean) {
		onreflow()
		drawerOpen = open
		if (!open) document.getElementById(`${focusId}-toggle`)?.focus({ preventScroll: true })
	}

	function toggleDrawer() {
		setDrawerOpen(!drawerOpen)
	}

	$effect(() => {
		if (focused) document.getElementById(focusId + '-show')?.focus({ preventScroll: true })
		else if (previousFocus) document.getElementById(focusId)?.focus({ preventScroll: true })
		previousFocus = focused
	})
</script>

<section
	class="reader-workspace"
	class:focused
	data-drawer-open={drawerOpen}
	aria-label={t('reader.heading')}
>
	{#if focused}
		<div class="reader-toggle" data-reader-overlay>
			<Button id={focusId + '-show'} onclick={onshowcontrols}>{t('reader.show_controls')}</Button>
		</div>
	{:else}
		<div class="reader-toggle" data-reader-overlay>
			<Button
				class="settings-toggle"
				id={`${focusId}-toggle`}
				aria-label={t('reader.controls')}
				aria-controls={drawerId}
				aria-expanded={drawerOpen}
				onclick={toggleDrawer}
			>
				<Icon width="24" height="24">
					{#if drawerOpen}<path d="m6 6 12 12M18 6 6 18" />
					{:else}<path d="M4 6h16M4 12h16M4 18h16" />{/if}
				</Icon>
			</Button>
		</div>
	{/if}
	<div class="reader-panels">
		<div class="reader-body" inert={drawerModal}>
			{#if message}<StatusMessage {...message} />{/if}
			<article>
				<div class="reader-heading">
					{#if !focused}<PageNavigation />{/if}
					<Heading level="h1" size="xxl">{title}</Heading>
					<div class="page-control-spacer" aria-hidden="true"></div>
				</div>
				{#if trashed}<ReaderActions
						{trashed}
						{archived}
						enabled={canOrganize}
						{onarchive}
						{onrestore}
					/>{/if}
				{#if readingMessage}<StatusMessage {...readingMessage} />{/if}
				<div
					style:--reader-font={preferences.font === 'serif'
						? 'ui-serif, Georgia, Cambria, serif'
						: 'system-ui, sans-serif'}
					style:--reader-size={preferences.size + 'px'}
					style:--reader-spacing={preferences.spacing}
					style:--reader-width={preferences.width + 'ch'}
				>
					<SavedContent
						{imageViews}
						{onretryimage}
						{onimageerror}
						{asset}
						{text}
						{sourceUrl}
						{onready}
						{onrelease}
						{onlink}
					/>
				</div>
				{#if !trashed}<footer>
						<ReaderActions {trashed} {archived} enabled={canOrganize} {onarchive} {onrestore} />
					</footer>{/if}
			</article>
		</div>
		{#if !focused}
			<Drawer
				class="reader-drawer"
				id={drawerId}
				side="right"
				heading={t('reader.controls')}
				headingHidden
				showCloseButton={false}
				closeLabel={t('actions.close')}
				bind:open={() => drawerOpen, setDrawerOpen}
			>
				<ReaderToolbar
					oncontents={() => {
						if (mobile) toggleDrawer()
					}}
					{sourceUrl}
					{preferences}
					{progress}
					{enabled}
					{headings}
					onchange={(change) => {
						onreflow()
						onchange(change)
					}}
					{onfocus}
					{focusId}
				/>
			</Drawer>
		{/if}
	</div>
	{#if drawerModal}
		<button
			class="settings-dismiss"
			type="button"
			aria-label={t('actions.close')}
			onclick={toggleDrawer}
		></button>
	{/if}
	<FootnotePreview id={footnoteId} note={footnote} {onfullnote} onclose={onfootnoteclose} />
</section>

<style>
	.reader-workspace {
		--dui-drawer-width: clamp(18rem, 30vw, 24rem);
		--dui-drawer-height: calc(100dvh - 2 * var(--app-padding, 1.5rem));
		--dui-drawer-padding: 0 0 0 var(--dui-spacing-md);
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		min-block-size: 100%;
		min-inline-size: 0;
	}

	.reader-panels {
		grid-area: 1 / 1;
		display: flex;
		align-items: flex-start;
		min-inline-size: 0;
	}

	.reader-body {
		flex: 1 1 0%;
		min-inline-size: 0;
	}

	.reader-heading {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
	}

	.page-control-spacer {
		inline-size: calc(var(--app-control-size, 44px) + var(--dui-spacing-xs));
		block-size: var(--app-control-size, 44px);
		transition: inline-size var(--dui-drawer-duration, 225ms);
	}

	.reader-workspace[data-drawer-open='true'] .page-control-spacer,
	.reader-workspace.focused .page-control-spacer {
		inline-size: 0;
	}

	.reader-workspace.focused .reader-heading {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.reader-toggle {
		grid-area: 1 / 1;
		align-self: start;
		justify-self: end;
		position: sticky;
		inset-block-start: 0;
		z-index: 3;
	}

	.reader-toggle :global(.settings-toggle) {
		--dui-button-padding: var(--dui-spacing-xs);
		inline-size: var(--app-control-size, 44px);
		block-size: var(--app-control-size, 44px);
		display: grid;
		place-items: center;
	}

	footer {
		display: flex;
		justify-content: center;
		margin-block: var(--dui-space-md);
	}

	@media (max-width: 48rem) {
		.reader-workspace {
			--dui-drawer-width: calc(100% - 3.5rem);
			--dui-drawer-padding: 0 0 0 var(--dui-spacing-sm);
		}

		.reader-panels {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}

		.reader-body,
		.reader-panels :global(.reader-drawer) {
			grid-area: 1 / 1;
		}

		.reader-panels :global(.reader-drawer) {
			justify-self: end;
			z-index: 2;
		}

		.settings-dismiss {
			grid-area: 1 / 1;
			align-self: start;
			justify-self: start;
			position: sticky;
			inset-block-start: 0;
			inline-size: 3.5rem;
			block-size: var(--dui-drawer-height);
			padding: 0;
			border: 0;
			background: transparent;
			z-index: 2;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.page-control-spacer {
			transition: none;
		}
	}
</style>
