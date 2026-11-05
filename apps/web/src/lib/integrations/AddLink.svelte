<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { Button, Dialog, FloatingActionButton, InputText, StatusMessage } from 'delightful-ui'
	import { libraryMachine, selectLibraryView } from '../machines/capture/library.js'
	import { action, t } from '../localization/index.js'

	let { actor }: { actor: ActorRefFrom<typeof libraryMachine> } = $props()
	const dialogId = $props.id()
	let snapshot = $state<SnapshotFrom<typeof libraryMachine>>()
	let open = $state(false)
	let url = $state('')
	const canAdd = $derived(snapshot?.can({ type: 'ADD', url }) ?? false)
	const view = $derived(selectLibraryView(snapshot))

	onMount(() => {
		const subscription = actor.subscribe((next) => (snapshot = next))
		return () => {
			subscription.unsubscribe()
			url = ''
		}
	})
</script>

{#if view.duplicateMessage}<StatusMessage {...view.duplicateMessage} />{/if}

{#if view.restoreCaptureId}
	<Button
		appearance="flat"
		disabled={!view.canOrganize}
		onclick={() =>
			actor.send({
				type: 'ORGANIZE',
				request: { id: view.restoreCaptureId!, field: 'trashed', value: false }
			})}>{action('restore', 'article')}</Button
	>
{/if}

<FloatingActionButton
	type="button"
	aria-label={action('add', 'link')}
	title={action('add', 'link')}
	aria-haspopup="dialog"
	aria-controls={dialogId}
	disabled={!canAdd}
	onclick={() => (open = true)}><span aria-hidden="true">+</span></FloatingActionButton
>

<Dialog id={dialogId} heading={action('add', 'link')} bind:open closedby="any">
	<form
		onsubmit={(event) => {
			event.preventDefault()
			actor.send({ type: 'ADD', url })
			open = false
			url = ''
		}}
	>
		<InputText
			label={t('capture.url_label')}
			name="url"
			type="url"
			bind:value={url}
			required
			maxlength={8192}
			autocomplete="url"
			disabled={!canAdd}
		/>
		<div class="dialog-actions">
			<Button type="button" onclick={() => (open = false)}>{t('actions.close')}</Button>
			<Button type="submit" disabled={!canAdd}>{action('add', 'link')}</Button>
		</div>
	</form>
</Dialog>

<style>
	form {
		display: grid;
		gap: var(--dui-space-sm);
	}

	.dialog-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: end;
		gap: var(--dui-space-sm);
	}
</style>
