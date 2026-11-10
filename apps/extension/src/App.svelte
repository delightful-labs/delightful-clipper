<script lang="ts">
	import Application from '../../web/src/lib/integrations/Application.svelte'
	import { accountWorker } from './account-client.js'
	import { t } from '../../web/src/lib/localization/index.js'
	import Settings from './Settings.svelte'
	const createWorker = () =>
		accountWorker(new Worker(new URL('./settings.worker.ts', import.meta.url), { type: 'module' }))
	const appId = __CLIPPER_APP_ID__
	const serverUrl = __CLIPPER_SERVER__
</script>

<svelte:head><title>{t('app.title')}</title></svelte:head>
<main>
	<h1>{t('app.title')}</h1>
	<Application {appId} {serverUrl} gatewayEnabled={false} atprotoEnabled={false} {createWorker}
		><Settings /></Application
	>
</main>

<style>
	main {
		max-width: 55rem;
		margin: 2rem auto;
		padding: 1rem;
	}
</style>
