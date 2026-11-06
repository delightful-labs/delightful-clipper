<script lang="ts">
	import { Button, Heading, StatusMessage } from 'delightful-ui'
	import type { ImageView } from '../../images/view-machine.js'
	import type { AssetResult } from '../../contracts/storage.js'
	import type { WorkflowMessage } from '../../contracts/feedback.js'
	import type { ReaderPreferences, ReaderChange } from '../../reader/schema.js'
	import type { ReaderHeading, ReaderFootnote } from '../../reader/structure.js'
	import { t } from '../../localization/index.js'
	import SavedContent from '../../integrations/SavedContent.svelte'
	import ReaderToolbar from './ReaderToolbar.svelte'
	import ContentsNavigation from './ContentsNavigation.svelte'
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
	$effect(() => {
		if (focused) document.getElementById(focusId + '-show')?.focus({ preventScroll: true })
		else if (previousFocus) document.getElementById(focusId)?.focus({ preventScroll: true })
		previousFocus = focused
	})
</script>

<section aria-label={t('reader.heading')}>
	{#if focused}
		<div class="reader-reveal" data-reader-overlay>
			<Button id={focusId + '-show'} appearance="flat" onclick={onshowcontrols}
				>{t('reader.show_controls')}</Button
			>
		</div>
	{:else}
		<ReaderToolbar
			{sourceUrl}
			{preferences}
			{progress}
			{enabled}
			onchange={(change) => {
				onreflow()
				onchange(change)
			}}
			{onfocus}
			{focusId}
		/>
		<ContentsNavigation {headings} />
	{/if}
	{#if message}<StatusMessage {...message} />{/if}
	<article>
		<Heading level="h2" size="xxl">{title}</Heading>
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
	<FootnotePreview id={footnoteId} note={footnote} {onfullnote} onclose={onfootnoteclose} />
</section>

<style>
	.reader-reveal {
		position: sticky;
		inset-block-start: 0;
		z-index: 2;
		display: flex;
		justify-content: end;
	}
	footer {
		display: flex;
		justify-content: center;
		margin-block: var(--dui-space-md);
	}
</style>
