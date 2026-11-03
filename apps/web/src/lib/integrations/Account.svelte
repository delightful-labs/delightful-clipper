<script lang="ts">
	import Library from './Library.svelte'
 import { onMount } from 'svelte'
	import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
	import { createActor } from 'xstate'
	import type { SnapshotFrom } from 'xstate'
	import RecoveryPhrase from 'delightful-local-first/recovery/svelte'
	import { Button, StatusMessage, Textarea } from 'delightful-ui'
	import { createApplicationReadinessMachine, selectApplicationView, selectRecoveryBinding,selectLibraryActor } from '../machines/runtime/application-readiness.js'
	import { accountInput, type Session } from '../backend/jazz/account.js'
	import { t, action, recoveryMessages } from '../localization/index.js'

	const applicationReadinessMachine = createApplicationReadinessMachine<Session>()
	let { appId, serverUrl, gatewayEnabled }: { appId: string; serverUrl: string;gatewayEnabled:boolean } = $props()
	let snapshot = $state<SnapshotFrom<typeof applicationReadinessMachine>>()
	let phrase = $state('')
	let send = $state<(event: {type: 'CREATE' | 'LOGOUT' | 'RETRY'} | {type: 'RESTORE'; phrase: string}) => void>(() => {})
	const configured = $derived(appId.length > 0 && serverUrl.length > 0)
	const view = $derived(selectApplicationView(snapshot, configured))
	const recovery = $derived(selectRecoveryBinding(snapshot))
 const library=$derived(selectLibraryActor(snapshot))

	onMount(() => {
		if (!appId || !serverUrl) return
		const actor = createActor(applicationReadinessMachine, {input:accountInput({appId,serverUrl,env:'clipper'})})
		send = (event) => actor.send(event)
		const subscription = actor.subscribe((next) => { snapshot = next })
		actor.start()
		return () => {
			subscription.unsubscribe()
			phrase = ''
			stopAfterShutdown(actor)
		}
	})
</script>

<section aria-label={t('app.title')}>
	<StatusMessage text={t(`account.status.${view.status}`)} />
	{#if view.feedback}
		<StatusMessage variant="error" text={t(`account.feedback.${view.feedback}`)} />
	{/if}
	{#if view.showIdentityForm}
		<Button type="button" onclick={() => send({type:'CREATE'})}>{action('create','account')}</Button>
		<form onsubmit={(event) => {
			event.preventDefault()
			const value = phrase
			phrase = ''
			send({type:'RESTORE',phrase:value})
		}}>
			<Textarea label={t('account.recovery.phrase_label')} bind:value={phrase} autocomplete="off" spellcheck={false} required />
			<Button type="submit">{action('restore','account')}</Button>
		</form>
	{/if}
	{#if recovery}
		<RecoveryPhrase source={recovery.source} capability={recovery.capability} messages={recoveryMessages()} />
	{/if}
	{#if view.requiresReload}<Button type="button" onclick={() => window.location.reload()}>{action('reload','page')}</Button>{/if}
	{#if view.canRetry}<Button type="button" onclick={() => send({type:'RETRY'})}>{t('actions.retry')}</Button>{/if}
	{#if view.canLogout}<Button type="button" onclick={() => send({type:'LOGOUT'})}>{t('actions.sign_out')}</Button>{/if}
</section>

{#if library}
 {#key library}
 <Library actor={library} {gatewayEnabled}/>
 {/key}
{/if}
