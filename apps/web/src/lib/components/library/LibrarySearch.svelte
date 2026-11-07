<script lang="ts">
	import { InputText } from 'delightful-ui'
	import { action } from '../../localization/index.js'
	let {
		query,
		enabled,
		onquery
	}: {
		query: string
		enabled: boolean
		onquery: (query: string) => void
	} = $props()
</script>

<InputText
	type="search"
	label={action('search', 'article', 2)}
	maxlength={512}
	disabled={!enabled}
	bind:value={() => query, onquery}
/>
