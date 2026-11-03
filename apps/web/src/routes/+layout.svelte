<script lang="ts">
	import OfflineShell from '../lib/integrations/OfflineShell.svelte'
	import type { Snippet } from 'svelte'
	import {
		PUBLIC_JAZZ_APP_ID,
		PUBLIC_JAZZ_SERVER_URL,
		CAPTURE_GATEWAY_ENABLED
	} from '$app/env/public'
	import 'delightful-ui/theme.css'
	import Account from '../lib/integrations/Account.svelte'
	import { t } from '../lib/localization/index.js'
	let { children }: { children: Snippet } = $props()
	let admitted = $state(false)
</script>

<svelte:head><title>{t('app.title')}</title></svelte:head>
<main>
	<h1>{t('app.title')}</h1>
	<OfflineShell
		onAdmission={() => {
			admitted = true
		}}
	/>
	{#if admitted}
		<Account
			appId={PUBLIC_JAZZ_APP_ID}
			serverUrl={PUBLIC_JAZZ_SERVER_URL}
			gatewayEnabled={CAPTURE_GATEWAY_ENABLED}>{@render children()}</Account
		>
	{/if}
</main>
