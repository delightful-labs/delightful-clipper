<script lang="ts">
	import { Button, InputText, StatusMessage } from 'delightful-ui'
	import type { WorkflowMessage } from '../../contracts/feedback.js'
	import { action, t } from '../../localization/index.js'
	let {
		query,
		enabled,
		message,
		canRetry,
		onquery,
		onretry
	}: {
		query: string
		enabled: boolean
		message: WorkflowMessage | undefined
		canRetry: boolean
		onquery: (query: string) => void
		onretry: () => void
	} = $props()
</script>

<InputText
	type="search"
	label={action('search', 'article', 2)}
	maxlength={512}
	disabled={!enabled}
	bind:value={() => query, onquery}
/>
{#if message}<StatusMessage {...message} />{/if}
{#if canRetry}<Button type="button" onclick={onretry}>{t('actions.retry')}</Button>{/if}
