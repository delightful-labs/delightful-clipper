<script lang="ts">
	import { RadioGroup, RadioItem } from 'delightful-ui'
	import { t } from '../../localization/index.js'
	import type { ReaderPreferences } from '../../reader/schema.js'
	let {
		value,
		disabled = false,
		onchange
	}: {
		value: ReaderPreferences['theme']
		disabled?: boolean
		onchange: (value: ReaderPreferences['theme']) => void
	} = $props()
</script>

<RadioGroup
	label={t('reader.theme')}
	bind:value={
		() => value,
		(value) => {
			if (value === 'light' || value === 'dark' || value === 'system') onchange(value)
		}
	}
	{disabled}
>
	<RadioItem value="light">{t('reader.light')}</RadioItem>
	<RadioItem value="dark">{t('reader.dark')}</RadioItem>
	<RadioItem value="system">{t('reader.system')}</RadioItem>
</RadioGroup>
