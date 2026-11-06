<script lang="ts">
	import { InputRange, Select } from 'delightful-ui'
	import { t } from '../../localization/index.js'
	import type { ReaderPreferences, ReaderChange } from '../../reader/schema.js'
	let {
		value,
		disabled = false,
		onchange
	}: {
		value: ReaderPreferences
		disabled?: boolean
		onchange: (change: Exclude<ReaderChange, { field: 'position' }>) => void
	} = $props()
</script>

<div class="font-settings">
	<Select
		label={t('reader.font_family')}
		{disabled}
		bind:value={
			() => value.font,
			(font) => {
				if (font === 'serif' || font === 'sans')
					onchange({ documentId: null, field: 'font', value: font })
			}
		}
	>
		<option value="serif">{t('reader.serif')}</option><option value="sans"
			>{t('reader.sans_serif')}</option
		>
	</Select>
	<InputRange
		label={t('reader.font_size')}
		min={16}
		max={32}
		step={1}
		{disabled}
		bind:value={
			() => value.size,
			(size) => {
				if (size !== undefined) onchange({ documentId: null, field: 'size', value: size })
			}
		}
	/>
	<InputRange
		label={t('reader.line_spacing')}
		min={1.3}
		max={2}
		step={0.1}
		{disabled}
		bind:value={
			() => value.spacing,
			(spacing) => {
				if (spacing !== undefined) onchange({ documentId: null, field: 'spacing', value: spacing })
			}
		}
	/>
	<InputRange
		label={t('reader.reading_width')}
		min={40}
		max={90}
		step={1}
		{disabled}
		bind:value={
			() => value.width,
			(width) => {
				if (width !== undefined) onchange({ documentId: null, field: 'width', value: width })
			}
		}
	/>
</div>

<style>
	.font-settings {
		display: grid;
		gap: var(--dui-space-sm);
	}
</style>
