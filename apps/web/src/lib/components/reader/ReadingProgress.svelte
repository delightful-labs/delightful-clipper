<script lang="ts">
	import { t } from '../../localization/index.js'
	let { value }: { value: number | undefined } = $props()
	const percent = $derived(
		value === undefined
			? undefined
			: new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value * 100)
	)
</script>

{#if value !== undefined}
	<span class="reading-progress"
		><progress max="1" {value} aria-label={t('reader.progress', { percent })}></progress><span
			>{t('reader.progress', { percent })}</span
		></span
	>
{/if}

<style>
	.reading-progress {
		display: inline-flex;
		align-items: center;
		gap: var(--dui-spacing-xs);
	}
	progress {
		max-inline-size: 8rem;
		accent-color: var(--dui-color-accent);
	}
</style>
