<script lang="ts">
	import { Button, Dialog } from 'delightful-ui'
	import { action, t } from '../../localization/index.js'
	import ThemeSettings from './ThemeSettings.svelte'
	import FontSettings from './FontSettings.svelte'
	import ReadingProgress from './ReadingProgress.svelte'
	import type { ReaderChange, ReaderPreferences } from '../../reader/schema.js'
	let {
		preferences,
		progress,
		sourceUrl,
		enabled,
		onchange,
		onfocus,
		focusId
	}: {
		preferences: ReaderPreferences
		progress: number | undefined
		sourceUrl: string | undefined
		enabled: boolean
		onchange: (change: ReaderChange) => void
		onfocus: () => void
		focusId: string
	} = $props()
	let open = $state(false)
</script>

<div class="reader-toolbar" data-reader-overlay>
	<a href="/">{action('open', 'library')}</a>
	{#if sourceUrl}<a href={sourceUrl} rel="noreferrer">{action('open', 'original')}</a>{/if}
	<Button appearance="flat" onclick={() => (open = true)}>{t('reader.controls')}</Button>
	<Button id={focusId} appearance="flat" onclick={onfocus}>{t('reader.focus_mode')}</Button>
	<ReadingProgress value={progress} />
</div>
<Dialog heading={t('reader.controls')} bind:open closedby="any">
	<div class="reader-settings">
		<ThemeSettings
			value={preferences.theme}
			disabled={!enabled}
			onchange={(value) => onchange({ documentId: null, field: 'theme', value })}
		/>
		<FontSettings value={preferences} disabled={!enabled} {onchange} />
		<Button onclick={() => (open = false)}>{t('actions.close')}</Button>
	</div>
</Dialog>

<style>
	.reader-toolbar {
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		background-color: var(--dui-color-background);
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--dui-spacing-sm);
	}
	.reader-settings {
		display: grid;
		gap: var(--dui-space-sm);
	}
</style>
