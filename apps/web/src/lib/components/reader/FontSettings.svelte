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
	const id = $props.id()
	const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
	const percentage = new Intl.NumberFormat('en', { style: 'percent' })
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
	<div class="slider-setting">
		<output for={`${id}-size`}>{number.format(value.size)}px</output>
		<InputRange
			id={`${id}-size`}
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
	</div>
	<div class="slider-setting">
		<output for={`${id}-spacing`}>{number.format(value.spacing)}</output>
		<InputRange
			id={`${id}-spacing`}
			label={t('reader.line_spacing')}
			min={1.3}
			max={2}
			step={0.1}
			{disabled}
			bind:value={
				() => value.spacing,
				(spacing) => {
					if (spacing !== undefined)
						onchange({ documentId: null, field: 'spacing', value: spacing })
				}
			}
		/>
	</div>
	<div class="slider-setting">
		<output for={`${id}-width`}>{percentage.format(value.width / 100)}</output>
		<InputRange
			id={`${id}-width`}
			label={t('reader.reading_width')}
			min={40}
			max={100}
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
</div>

<style>
	.font-settings {
		display: grid;
		gap: var(--dui-space-sm);
	}

	.slider-setting {
		display: grid;
	}

	.slider-setting > :global(.wrapper),
	.slider-setting > output {
		grid-area: 1 / 1;
	}

	.slider-setting :global(label) {
		margin-inline-end: 6ch;
	}

	.slider-setting > output {
		align-self: start;
		justify-self: end;
		font-family: var(--dui-field-font-family, var(--dui-font-family-interactive));
		font-size: var(--dui-field-font-size, var(--dui-font-size-sm, 0.875rem));
	}
</style>
