<script lang="ts">
	import { onMount } from 'svelte'
	import type { LibraryClient } from '../runtime/worker/client.js'
	import type { LibraryRender } from '../runtime/worker/views.js'
	import { Button, Dialog, TagInput } from 'delightful-ui'
	import type { LibraryArticle } from '../contracts/articles.js'
	import { tagComparisonKey, type Tag } from '../capture/tags.js'

	import { action, noun, t } from '../localization/index.js'
	let {
		actor,
		row,
		tags,
		enabled,
		onclose,
		open = $bindable(false)
	}: {
		actor: LibraryClient
		row: LibraryArticle | undefined
		tags: Tag[]
		enabled: boolean
		onclose?: () => void
		open?: boolean
	} = $props()
	let snapshot = $state<LibraryRender>()
	const send = (event: Parameters<LibraryClient['tags']>[0]) => actor.tags(event)
	const form = $derived(snapshot?.tagForm ?? actor.getView().tagForm)
	let inputHost = $state<HTMLDivElement>()
	let pendingFocus = $state<{ target: HTMLElement; keys: string[] }>()
	$effect(() => {
		if (!enabled || !pendingFocus) return
		const pending = pendingFocus
		const selected = (row?.tags ?? []).map((tag) => tagComparisonKey(tag.name)).sort()
		if (
			selected.length !== pending.keys.length ||
			selected.some((key, index) => key !== pending.keys[index])
		)
			return
		const target = pending.target
		pendingFocus = undefined
		if (document.activeElement !== document.body) return
		if (target.isConnected) target.focus()
		else inputHost?.querySelector<HTMLInputElement>('input[type="text"]')?.focus()
	})
	onMount(() => {
		const subscription = actor.subscribe((next) => (snapshot = next))
		return () => subscription.unsubscribe()
	})
</script>

<Dialog
	heading={noun('tag', 2)}
	bind:open
	closedby="any"
	onclose={() => {
		send({ type: 'RESET' })
		onclose?.()
	}}
>
	{#if open && row}
		{@const article = row}
		{#key article.id}
			<div bind:this={inputHost} oninput={() => send({ type: 'RESET' })}>
				<TagInput
					normalizeTag={tagComparisonKey}
					label={noun('tag', 2)}
					addLabel={action('add', 'tag')}
					removeLabel={(name) => t('actions.remove_name', { name })}
					selectedTagsLabel={noun('tag', 2)}
					addedMessage={(name) =>
						form.message?.text ?? t('status.selected_subject_name', { subject: noun('tag'), name })}
					removedMessage={(name) =>
						t('status.removed_subject_name', { subject: noun('tag'), name })}
					duplicateMessage={(name) =>
						t('errors.already_selected_subject_name', { subject: noun('tag'), name })}
					suggestions={tags.map((tag) => tag.name)}
					readonly={!enabled}
					{...form.message ? { errorMessage: form.message.text } : {}}
					bind:value={
						() => {
							void form.revision
							return article.tags?.map((tag) => tag.name) ?? []
						},
						(names) => {
							pendingFocus =
								document.activeElement instanceof HTMLElement
									? { target: document.activeElement, keys: names.map(tagComparisonKey).sort() }
									: undefined
							send({ type: 'SELECT', id: article.id, names })
						}
					}
				/>
			</div>
			<div class="actions">
				<Button type="button" onclick={() => (open = false)}>{t('actions.close')}</Button>
			</div>
		{/key}
	{/if}
</Dialog>

<style>
	.actions {
		display: flex;
		justify-content: end;
		margin-block-start: var(--dui-spacing-sm);
	}
</style>
