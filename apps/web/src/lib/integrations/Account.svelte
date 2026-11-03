<script lang="ts">
	import { onMount } from 'svelte'
	import { createActor } from 'xstate'
	import type { SnapshotFrom } from 'xstate'
	import RecoveryPhrase from 'delightful-local-first/recovery/svelte'
	import { Button, StatusMessage, Textarea } from 'delightful-ui'
	import { createApplicationReadinessMachine, selectApplicationView, selectRecoveryBinding } from '../machines/runtime/application-readiness.js'
	import { accountInput, type Session } from '../backend/jazz/account.js'
	import { t, recoveryMessages } from '../localization/index.js'

	const applicationReadinessMachine = createApplicationReadinessMachine<Session>()
	let { appId, serverUrl }: { appId: string; serverUrl: string } = $props()
	let snapshot = $state<SnapshotFrom<typeof applicationReadinessMachine>>()
	let phrase = $state('')
	let send = $state<(event: {type: 'CREATE' | 'LOGOUT' | 'RETRY'} | {type: 'RESTORE'; phrase: string}) => void>(() => {})
	const configured = $derived(appId.length > 0 && serverUrl.length > 0)
	const view = $derived(selectApplicationView(snapshot, configured))
	const recovery = $derived(selectRecoveryBinding(snapshot))

	onMount(() => {
		if (!appId || !serverUrl) return
		const actor = createActor(applicationReadinessMachine, {input:accountInput({appId,serverUrl,env:'clipper'})})
		send = (event) => actor.send(event)
		const subscription = actor.subscribe((next) => { snapshot = next })
		actor.start()
		return () => {
			subscription.unsubscribe()
			phrase = ''
			// Drain attachment resources; DLF retains the application-scoped session owner.
			const terminal = actor.subscribe((next) => {
				if (next.status === 'done') { terminal.unsubscribe(); actor.stop() }
			})
			actor.send({type:'SHUTDOWN'})
		}
	})
</script>

<section aria-label={t('title')}>
	<StatusMessage text={t(view.status)} />
	{#if view.feedback}
		<StatusMessage variant="error" text={t(view.feedback)} />
	{/if}
	{#if view.showIdentityForm}
		<Button type="button" onclick={() => send({type:'CREATE'})}>{t('create')}</Button>
		<form onsubmit={(event) => {
			event.preventDefault()
			const value = phrase
			phrase = ''
			send({type:'RESTORE',phrase:value})
		}}>
			<Textarea label={t('phrase')} bind:value={phrase} autocomplete="off" spellcheck={false} required />
			<Button type="submit">{t('restore')}</Button>
		</form>
	{/if}
	{#if recovery}
		<RecoveryPhrase source={recovery.source} capability={recovery.capability} messages={recoveryMessages()} />
	{/if}
	{#if view.canRetry}<Button type="button" onclick={() => send({type:'RETRY'})}>{t('retry')}</Button>{/if}
	{#if view.canLogout}<Button type="button" onclick={() => send({type:'LOGOUT'})}>{t('logout')}</Button>{/if}
</section>
