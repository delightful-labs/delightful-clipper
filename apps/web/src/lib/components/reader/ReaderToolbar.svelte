<script lang="ts">
	import { Button, Heading } from 'delightful-ui'
	import { action, t } from '../../localization/index.js'
	import ContentsNavigation from './ContentsNavigation.svelte'
	import type { ReaderHeading } from '../../reader/structure.js'
	import ThemeSettings from './ThemeSettings.svelte'
	import FontSettings from './FontSettings.svelte'
	import ReadingProgress from './ReadingProgress.svelte'
	import type { ReaderChange, ReaderPreferences } from '../../reader/schema.js'
	let {
		oncontents,
		headings,
		preferences,
		progress,
		sourceUrl,
		enabled,
		onchange,
		onfocus,
		focusId
	}: {
		oncontents: () => void
		headings: ReaderHeading[]
		preferences: ReaderPreferences
		progress: number | undefined
		sourceUrl: string | undefined
		enabled: boolean
		onchange: (change: ReaderChange) => void
		onfocus: () => void
		focusId: string
	} = $props()
</script>

<div class="reader-settings">
	<div class="settings-heading">
		<Heading level="h2" size="lg">{t('reader.controls')}</Heading>
		<div class="control-spacer" aria-hidden="true"></div>
	</div>
	<Button id={focusId} onclick={onfocus}>{t('reader.focus_mode')}</Button>
	<a href="/">{action('open', 'library')}</a>
	{#if sourceUrl}<a href={sourceUrl} rel="noreferrer">{action('open', 'original')}</a>{/if}
	<ReadingProgress value={progress} />
	<ContentsNavigation {headings} onnavigate={oncontents} />
	<ThemeSettings
		value={preferences.theme}
		disabled={!enabled}
		onchange={(value) => onchange({ documentId: null, field: 'theme', value })}
	/>
	<FontSettings value={preferences} disabled={!enabled} {onchange} />
</div>

<style>
	.reader-settings {
		display: grid;
		gap: var(--dui-space-sm);
		min-inline-size: 0;
	}

	.settings-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--app-control-size, 44px);
		align-items: center;
		gap: var(--dui-spacing-xs);
	}

	.control-spacer {
		block-size: var(--app-control-size, 44px);
	}
</style>
