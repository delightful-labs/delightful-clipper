<script lang="ts">
	import { Button } from 'delightful-ui'
	import { t, action } from '../../localization/index.js'
	let {
		trashed,
		archived,
		enabled,
		onrestore,
		onarchive
	}: {
		trashed: boolean
		archived: boolean
		enabled: boolean
		onrestore: () => void
		onarchive: () => void
	} = $props()
</script>

{#if trashed}<Button appearance="flat" disabled={!enabled} onclick={onrestore}
		>{action('restore', 'article')}</Button
	>
{:else if !archived}<Button appearance="flat" disabled={!enabled} onclick={onarchive}
		>{t('library.views.archive')}</Button
	>{/if}
