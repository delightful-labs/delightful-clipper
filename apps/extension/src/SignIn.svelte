<script lang="ts">
	import { z } from 'zod'
	import { onMount } from 'svelte'
	import { createActor } from 'xstate'
	import type { SnapshotFrom } from 'xstate'
	import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
	import { Button, StatusMessage, Textarea } from 'delightful-ui'
	import { existingAccountInput, type Session } from '../../web/src/lib/backend/jazz/account.js'
	import { createApplicationReadinessMachine } from '../../web/src/lib/machines/runtime/application-readiness.js'
	import { action, t } from '../../web/src/lib/localization/index.js'
	import { extensionLibrary } from './library.js'
	import { createSignInMachine, connectionObservation, signInView } from './signin-machine.js'
	import { confirmConnection } from './connect.js'
	const request = z.uuid().safeParse(new URLSearchParams(location.search).get('request'))
	const requestId = request.success ? request.data : undefined
	const application = createApplicationReadinessMachine<Session>()
	const owner = createActor(application, {
		input: existingAccountInput(
			{ appId: __CLIPPER_APP_ID__, serverUrl: __CLIPPER_SERVER__, env: 'clipper' },
			extensionLibrary
		)
	})
	const machine = createSignInMachine({
		connect: (accountId) => confirmConnection(accountId, requestId),
		connected: () => window.close(),
		restore: {
			can: () => owner.getSnapshot().can({ type: 'RESTORE', phrase: '' }),
			send: (phrase) => owner.send({ type: 'RESTORE', phrase })
		}
	})
	const connection = createActor(machine)
	let snapshot = $state<SnapshotFrom<typeof application>>()
	let confirmation = $state(connection.getSnapshot())
	let phrase = $state('')
	const view = $derived(signInView(snapshot, confirmation))
	onMount(() => {
		const selection = connection.subscribe((next) => {
			confirmation = next
		})
		const subscription = owner.subscribe((next) => {
			snapshot = next
			connection.send({ type: 'OBSERVED', observation: connectionObservation(next) })
		})
		connection.start()
		owner.start()
		return () => {
			phrase = ''
			subscription.unsubscribe()
			selection.unsubscribe()
			stopAfterShutdown(connection)
			stopAfterShutdown(owner)
		}
	})
</script>

<svelte:head><title>{t('app.title')}</title></svelte:head>
<main>
	<h1>{action('restore', 'account')}</h1>
	{#if view.message}<StatusMessage {...view.message} />{/if}
	<form
		onsubmit={(event) => {
			event.preventDefault()
			const value = phrase
			phrase = ''
			connection.send({ type: 'RESTORE', phrase: value })
		}}
	>
		<Textarea
			label={t('account.recovery.phrase_label')}
			bind:value={phrase}
			autocomplete="off"
			spellcheck={false}
			required
			disabled={!confirmation.can({ type: 'RESTORE', phrase: '' })}
		/>
		<Button type="submit" disabled={!confirmation.can({ type: 'RESTORE', phrase: '' })}
			>{action('restore', 'account')}</Button
		>
	</form>
	{#if confirmation.can({ type: 'RETRY' })}<Button
			onclick={() => connection.send({ type: 'RETRY' })}>{t('actions.retry')}</Button
		>{/if}
	<a href={__CLIPPER_WEB__} target="_blank" rel="noreferrer">{action('open', 'library')}</a>
</main>

<style>
	main {
		max-width: 32rem;
		margin: 1.5rem auto;
		padding: 1rem;
	}
	form {
		display: grid;
		gap: 1rem;
		margin-block: 1rem;
	}
</style>
