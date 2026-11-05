<script lang="ts">
	import OfflineShell from '../lib/integrations/OfflineShell.svelte'
	import type { Snippet } from 'svelte'
	import {
		PUBLIC_JAZZ_APP_ID,
		PUBLIC_JAZZ_SERVER_URL,
		CAPTURE_GATEWAY_ENABLED
	} from '$app/env/public'
	import 'delightful-ui/theme.css'
	import AppShell from '../lib/integrations/AppShell.svelte'
	import Account from '../lib/integrations/Account.svelte'
	import { t } from '../lib/localization/index.js'
	let { children }: { children: Snippet } = $props()
	let admitted = $state(false)
</script>

<svelte:head><title>{t('app.title')}</title></svelte:head>
{#if !admitted}<div><h1>{t('app.title')}</h1></div>{/if}
{#if admitted}
	<Account
		appId={PUBLIC_JAZZ_APP_ID}
		serverUrl={PUBLIC_JAZZ_SERVER_URL}
		gatewayEnabled={CAPTURE_GATEWAY_ENABLED}
	>
		{#snippet shell(account, content, connectionMessage)}
			<AppShell {account} {connectionMessage}>{@render content()}</AppShell>
		{/snippet}
		{@render children()}
	</Account>
{/if}
<div data-offline-shell>
	<OfflineShell
		onAdmission={() => {
			admitted = true
		}}
	/>
</div>
