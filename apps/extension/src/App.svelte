<script lang="ts">
	import { onMount } from 'svelte'
	import { createActor } from 'xstate'
	import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
	import { createSignInMachine, connectionObservation } from './signin-machine.js'
	import { confirmConnection } from './connect.js'
	import Account from '../../web/src/lib/integrations/Account.svelte'
	import { t } from '../../web/src/lib/localization/index.js'
	import Settings from './Settings.svelte'
	import { extensionLibrary } from './library.js'
	const connection = createActor(
		createSignInMachine({ connect: confirmConnection, connected: () => {} })
	)
	onMount(() => {
		connection.start()
		return () => stopAfterShutdown(connection)
	})
	const appId = __CLIPPER_APP_ID__
	const serverUrl = __CLIPPER_SERVER__
</script>

<svelte:head><title>{t('app.title')}</title></svelte:head>
<main>
	<h1>{t('app.title')}</h1>
	<Account
		{appId}
		{serverUrl}
		gatewayEnabled={false}
		libraryFactory={extensionLibrary}
		onSnapshot={(snapshot) =>
			connection.send({ type: 'OBSERVED', observation: connectionObservation(snapshot) })}
		><Settings /></Account
	>
</main>

<style>
	main {
		max-width: 55rem;
		margin: 2rem auto;
		padding: 1rem;
	}
</style>
