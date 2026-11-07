<script lang="ts">
	import { onMount, setContext, type Snippet } from 'svelte'
	import { Button, StatusMessage, Textarea } from 'delightful-ui'
	import RecoveryView from 'delightful-local-first/recovery/view'
	import type { RecoveryPhraseView } from 'delightful-local-first/recovery/contracts'
	import { openApplicationClient } from '../runtime/worker/client.js'
	import type { LibraryClient } from '../runtime/worker/client.js'
	import type { RuntimeView } from '../runtime/worker/views.js'
	import { workerLibraryContextKey } from '../runtime/worker/context.js'
	import type { WorkflowMessage } from '../contracts/feedback.js'
	import { action, t, recoveryMessages } from '../localization/index.js'
	let {
		appId,
		serverUrl,
		children,
		shell
	}: {
		appId: string
		serverUrl: string
		children: Snippet
		gatewayEnabled: boolean
		shell?: Snippet<[Snippet, Snippet, WorkflowMessage | undefined]>
	} = $props()
	let view = $state<RuntimeView['account']>()
	let library = $state<LibraryClient>()
	let phrase = $state('')
	let recovery = $state<RecoveryPhraseView>({ kind: 'unavailable' })
	let recoveryAvailable = $state(false)
	let recoveryScope = ''
	let accountScope = ''
	let client: ReturnType<typeof openApplicationClient> | undefined
	let bound: ReturnType<ReturnType<typeof openApplicationClient>['library']> | undefined
	let failed = $state(false)
	setContext(workerLibraryContextKey, {
		get actor() {
			return library
		}
	})
	onMount(() => {
		if (!appId || !serverUrl) return
		client = openApplicationClient({
			appId,
			serverUrl,
			publish: (next) => {
				accountScope = next.scope
				view = next.account
				if (!next.library) {
					library = undefined
					bound = undefined
					return
				}
				if (bound?.client.getView().scope !== next.library.scope) {
					bound = client?.library(next.library)
					library = bound?.client
				} else bound.update(next.library)
			},
			recovery: (next, available, scope) => {
				recovery = next
				recoveryAvailable = available
				recoveryScope = scope
			},
			failed: () => {
				failed = true
				library = undefined
				recovery = { kind: 'closed' }
			}
		})
		return () => {
			recovery = { kind: 'closed' }
			phrase = ''
			client?.close()
		}
	})
	function account(
		event: { type: 'CREATE' | 'LOGOUT' | 'RETRY' } | { type: 'RESTORE'; phrase: string }
	) {
		client?.post({ type: 'ACCOUNT', scope: accountScope, event })
	}
	function recover(type: 'REVEAL' | 'RETRY' | 'HIDE') {
		client?.post({ type: 'RECOVERY', scope: recoveryScope, event: { type } })
	}
</script>

{#snippet controls()}
	<section class="account-controls" aria-label={t('app.title')}>
		{#if view?.message.text}<StatusMessage {...view.message} />{/if}
		{#if view?.feedbackMessage}<StatusMessage {...view.feedbackMessage} />{/if}
		{#if view?.showIdentityForm}<Button type="button" onclick={() => account({ type: 'CREATE' })}
				>{action('create', 'account')}</Button
			>{/if}
		{#if view?.canRestore}
			<form
				onsubmit={(event) => {
					event.preventDefault()
					const value = phrase
					phrase = ''
					account({ type: 'RESTORE', phrase: value })
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
		{#if recoveryAvailable}<RecoveryView
				view={recovery}
				messages={recoveryMessages()}
				onReveal={() => recover('REVEAL')}
				onRetry={() => recover('RETRY')}
				onHide={() => recover('HIDE')}
			/>{/if}
		{#if failed || view?.requiresReload}<Button
				type="button"
				onclick={() => window.location.reload()}>{action('reload', 'page')}</Button
			>{/if}
		{#if view?.canRetry}<Button type="button" onclick={() => account({ type: 'RETRY' })}
				>{t('actions.retry')}</Button
			>{/if}
		{#if view?.canLogout}<Button type="button" onclick={() => account({ type: 'LOGOUT' })}
				>{t('actions.sign_out')}</Button
			>{/if}
	</section>
{/snippet}
{#if shell}{@render shell(
		controls,
		children,
		view?.connectionMessage
	)}{:else}{@render controls()}{@render children()}{/if}

<style>
	.account-controls {
		display: grid;
		gap: var(--dui-space-sm);
		min-inline-size: 0;
	}
	.account-controls form {
		display: grid;
		gap: var(--dui-spacing-sm);
	}
</style>
