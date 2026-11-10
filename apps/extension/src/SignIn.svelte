<script lang="ts">
	import { onMount } from 'svelte'
	import { Button, StatusMessage, Textarea } from 'delightful-ui'
	import { openApplicationClient } from '../../web/src/lib/runtime/worker/client.js'
	import { action, t } from '../../web/src/lib/localization/index.js'
	import { accountWorker, type ConnectionView } from './account-client.js'
	let view = $state<ConnectionView>({ message: undefined, canRestore: false, canRetry: false })
	let phrase = $state('')
	let native: ReturnType<typeof accountWorker> | undefined
	onMount(() => {
		const client = openApplicationClient({
			appId: __CLIPPER_APP_ID__,
			serverUrl: __CLIPPER_SERVER__,
			createWorker: () => {
				native = accountWorker(
					new Worker(new URL('./signin.worker.ts', import.meta.url), { type: 'module' }),
					(next) => {
						view = next
					}
				)
				return native
			},
			publish: () => {},
			recovery: () => {},
			failed: () => {
				view = { ...view, canRestore: false, canRetry: false }
			}
		})
		return () => {
			phrase = ''
			client.close()
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
			native?.post({ type: 'RESTORE', phrase: value })
		}}
	>
		<Textarea
			label={t('account.recovery.phrase_label')}
			bind:value={phrase}
			autocomplete="off"
			spellcheck={false}
			required
			disabled={!view.canRestore}
		/>
		<Button type="submit" disabled={!view.canRestore}>{action('restore', 'account')}</Button>
	</form>
	{#if view.canRetry}<Button onclick={() => native?.post({ type: 'RETRY' })}
			>{t('actions.retry')}</Button
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
