<script lang="ts">
	import { inspectMachines } from '../diagnostics/inspect.js'
	import { onMount, setContext, type Snippet } from 'svelte'
	import { libraryContextKey, type LibraryContext } from '../runtime/library-context.js'
	import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
	import { createActor } from 'xstate'
	import type { ApplicationSnapshot } from '../machines/runtime/application-readiness.js'
	import type { SnapshotFrom } from 'xstate'
	import RecoveryPhrase from 'delightful-local-first/recovery/svelte'
	import { Button, StatusMessage, Textarea } from 'delightful-ui'
	import {
		createApplicationReadinessMachine,
		selectApplicationView,
		selectRecoveryBinding,
		selectLibraryActor
	} from '../machines/runtime/application-readiness.js'
	import { accountInput, type Session, type LibraryFactory } from '../backend/jazz/account.js'
	import { t, action } from '../localization/index.js'

	const applicationReadinessMachine = createApplicationReadinessMachine<Session>()
	let {
		appId,
		serverUrl,
		gatewayEnabled,
		children,
		onSnapshot,
		libraryFactory
	}: {
		appId: string
		serverUrl: string
		gatewayEnabled: boolean
		children: Snippet
		libraryFactory?: LibraryFactory
		onSnapshot?: (snapshot: ApplicationSnapshot<Session>) => void
	} = $props()
	let snapshot = $state<SnapshotFrom<typeof applicationReadinessMachine>>()
	let phrase = $state('')
	let send = $state<
		(event: { type: 'CREATE' | 'LOGOUT' | 'RETRY' } | { type: 'RESTORE'; phrase: string }) => void
	>(() => {})
	const configured = $derived(appId.length > 0 && serverUrl.length > 0)
	const view = $derived(selectApplicationView(snapshot, configured))
	const recovery = $derived(selectRecoveryBinding(snapshot))
	const library = $derived(selectLibraryActor(snapshot))
	setContext<LibraryContext>(libraryContextKey, {
		get actor() {
			return library
		},
		get gatewayEnabled() {
			return gatewayEnabled
		}
	})

	onMount(() => {
		if (!appId || !serverUrl) return
		const actor = createActor(applicationReadinessMachine, {
			input: accountInput({ appId, serverUrl, env: 'clipper' }, libraryFactory),
			inspect: inspectMachines
		})
		send = (event) => actor.send(event)
		const subscription = actor.subscribe((next) => {
			snapshot = next
			onSnapshot?.(next)
		})
		actor.start()
		return () => {
			subscription.unsubscribe()
			phrase = ''
			stopAfterShutdown(actor)
		}
	})
</script>

<section aria-label={t('app.title')}>
	<StatusMessage {...view.message} />
	{#if view.feedbackMessage}
		<StatusMessage {...view.feedbackMessage} />
	{/if}
	{#if view.showIdentityForm}
		<Button type="button" onclick={() => send({ type: 'CREATE' })}
			>{action('create', 'account')}</Button
		>
	{/if}
	{#if view.canRestore}
		<form
			onsubmit={(event) => {
				event.preventDefault()
				const value = phrase
				phrase = ''
				send({ type: 'RESTORE', phrase: value })
			}}
		>
			<Textarea
				label={t('account.recovery.phrase_label')}
				bind:value={phrase}
				autocomplete="off"
				spellcheck={false}
				required
			/>
			<Button type="submit">{action('restore', 'account')}</Button>
		</form>
	{/if}
	{#if recovery}
		<RecoveryPhrase
			source={recovery.source}
			capability={recovery.capability}
			messages={recovery.messages}
		/>
	{/if}
	{#if view.requiresReload}<Button type="button" onclick={() => window.location.reload()}
			>{action('reload', 'page')}</Button
		>{/if}
	{#if view.canRetry}<Button type="button" onclick={() => send({ type: 'RETRY' })}
			>{t('actions.retry')}</Button
		>{/if}
	{#if view.canLogout}<Button type="button" onclick={() => send({ type: 'LOGOUT' })}
			>{t('actions.sign_out')}</Button
		>{/if}
</section>

{@render children()}
