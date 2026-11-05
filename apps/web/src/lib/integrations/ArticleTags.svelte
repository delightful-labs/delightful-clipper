<script lang="ts">
	import { onMount } from 'svelte'
	import { createActor, type ActorRefFrom, type SnapshotFrom } from 'xstate'
	import { Button, Dialog, TagInput } from 'delightful-ui'
	import { libraryMachine } from '../machines/capture/library.js'
	import type { LibraryArticle } from '../contracts/articles.js'
	import { tagComparisonKey, type Tag } from '../capture/tags.js'
	import {
		tagFormMachine,
		selectTagFormView,
		type TagFormEvent
	} from '../machines/capture/tag-form.js'
	import { action, noun, t } from '../localization/index.js'
	let {
		actor,
		row,
		tags,
		enabled,
		onclose,
		open = $bindable(false)
	}: {
		actor: ActorRefFrom<typeof libraryMachine>
		row: LibraryArticle | undefined
		tags: Tag[]
		enabled: boolean
		onclose?: () => void
		open?: boolean
	} = $props()
	let snapshot = $state<SnapshotFrom<typeof tagFormMachine>>()
	let send: (event: TagFormEvent) => void = () => {}
	const form = $derived(selectTagFormView(snapshot))
	let inputHost = $state<HTMLDivElement>()
	let pendingFocus = $state<HTMLElement>()
	$effect(() => {
		if (!enabled || !pendingFocus) return
		const target = pendingFocus
		pendingFocus = undefined
		if (document.activeElement !== document.body) return
		if (target.isConnected) target.focus()
		else inputHost?.querySelector<HTMLInputElement>('input[type="text"]')?.focus()
	})
	onMount(() => {
		const validation = createActor(tagFormMachine, { input: { library: actor } })
		const subscription = validation.subscribe((next) => (snapshot = next))
		send = (event) => validation.send(event)
		validation.start()
		return () => {
			subscription.unsubscribe()
			validation.stop()
		}
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
								document.activeElement instanceof HTMLElement ? document.activeElement : undefined
							send({ type: 'SELECT', id: article.id, names, previous: article.tags ?? [], enabled })
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
