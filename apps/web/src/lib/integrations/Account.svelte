<script lang="ts">
	import { onMount } from 'svelte'
	import { createActor } from 'xstate'
	import type { SnapshotFrom } from 'xstate'
	import RecoveryPhrase from 'delightful-local-first/recovery/svelte'
	import { Button, StatusMessage, Textarea } from 'delightful-ui'
	import { createAccountMachine } from '../machines/account.js'
	import { accountInput, type Session } from '../backend/jazz/account.js'
	import { t, recoveryMessages } from '../localization/index.js'

	const accountMachine = createAccountMachine<Session>()
	let { appId, serverUrl }: { appId: string; serverUrl: string } = $props()
	let snapshot = $state<SnapshotFrom<typeof accountMachine>>()
	let phrase = $state('')
	let send = $state<(event: {type: 'CREATE' | 'LOGOUT' | 'RETRY'} | {type: 'RESTORE'; phrase: string}) => void>(() => {})
	const configured = $derived(appId.length > 0 && serverUrl.length > 0)
	const signedOut = $derived(snapshot?.matches({running:'signedOut'}) ?? false)
	const ready = $derived(snapshot?.matches({running:{library:'ready'}}) ?? false)
	const recovery = $derived(snapshot?.matches({running:'library'}) && snapshot?.context.observation.status === 'ready' ? snapshot.context.observation.recovery : undefined)
	const statusKey = $derived.by(() => {
		if (!configured) return 'configuration'
		if (!snapshot || snapshot.matches('opening')) return 'starting'
		if (snapshot.matches({running:'signedOut'})) return 'signedOut'
		if (snapshot.matches({running:{library:{ready:'synced'}}})) return 'synced'
		if (snapshot.matches({running:{library:{ready:'syncFailed'}}})) return 'syncFailed'
		if (ready) return 'localSaved'
		if (snapshot.matches({running:{library:'failed'}})) return 'rootFailed'
		if (snapshot.matches({running:{library:'conflict'}})) return 'conflict'
		if (snapshot.matches({running:'library'})) return 'openingLibrary'
		if (snapshot.matches('openFailed') || snapshot.matches({running:'unavailable'})) return 'unavailable'
		if (snapshot.matches('closing') || snapshot.matches({running:'draining'})) return 'closing'
		if (snapshot.matches('closed')) return 'closed'
		return 'working'
	})
	const canLogout = $derived(snapshot?.can({type:'LOGOUT'}) ?? false)
	const retry = $derived(snapshot?.can({type:'RETRY'}) ?? false)

	onMount(() => {
		if (!appId || !serverUrl) return
		const actor = createActor(accountMachine, {input:accountInput({appId,serverUrl,env:'clipper'})})
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
	<StatusMessage text={t(statusKey)} />
	{#if snapshot && snapshot.context.feedback !== 'none'}
		<StatusMessage variant="error" text={t(snapshot.context.feedback)} />
	{/if}
	{#if signedOut}
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
	{#if retry}<Button type="button" onclick={() => send({type:'RETRY'})}>{t('retry')}</Button>{/if}
	{#if canLogout}<Button type="button" onclick={() => send({type:'LOGOUT'})}>{t('logout')}</Button>{/if}
</section>
