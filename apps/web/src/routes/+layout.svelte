<script lang="ts">
	import type { Snippet } from 'svelte'
	import { PUBLIC_JAZZ_APP_ID, PUBLIC_JAZZ_SERVER_URL } from '$app/env/public'
	import 'delightful-ui/theme.css'
	import Account from '../lib/integrations/Account.svelte'
	import { t } from '../lib/localization/index.js'
	let { children, data }: { children: Snippet;data:{gatewayEnabled:boolean} } = $props()
</script>

<svelte:head><title>{t('title')}</title></svelte:head>
<main>
	<h1>{t('title')}</h1>
	<Account appId={PUBLIC_JAZZ_APP_ID} serverUrl={PUBLIC_JAZZ_SERVER_URL} gatewayEnabled={data.gatewayEnabled} />
	{@render children()}
</main>
