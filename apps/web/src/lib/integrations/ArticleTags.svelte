<script lang="ts">
	import { onMount } from 'svelte'
	import { createActor, type ActorRefFrom, type SnapshotFrom } from 'xstate'
	import { Button, Checkbox, Dialog, InputText, FieldFeedback } from 'delightful-ui'
	import { libraryMachine } from '../machines/capture/library.js'
	import type { LibraryArticle } from '../contracts/articles.js'
	import type { Tag } from '../capture/tags.js'
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
	const fieldId = $props.id()
	let snapshot = $state<SnapshotFrom<typeof tagFormMachine>>()
	let send: (event: TagFormEvent) => void = () => {}
	const form = $derived(selectTagFormView(snapshot))
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
	{#if row}
		{@const article = row}
		<div class="tags">
			{#each tags as tag (tag.key)}
				<Checkbox
					label={tag.name}
					disabled={!enabled}
					bind:checked={
						() => article.tags?.some((assigned) => assigned.key === tag.key) ?? false,
						(assigned) =>
							actor.send({
								type: 'ORGANIZE',
								request: { id: article.id, field: 'tag', value: tag.name, assigned }
							})
					}
				/>
			{/each}
		</div>
		<form
			novalidate
			onsubmit={(event) => {
				event.preventDefault()
				send({ type: 'SUBMIT', id: article.id, enabled })
			}}
		>
			<InputText
				label={noun('tag')}
				id={fieldId}
				bind:value={() => form.name, (name) => send({ type: 'CHANGE', name })}
				aria-invalid={form.invalid || undefined}
				aria-describedby={form.message ? `${fieldId}-error` : undefined}
				required
				maxlength={256}
				disabled={!enabled}
			/>
			{#if form.message}<FieldFeedback
					id={`${fieldId}-error`}
					role="alert"
					errorMessage={form.message.text}
				/>{/if}
			<div class="actions">
				<Button
					type="button"
					onclick={() => {
						open = false
						send({ type: 'RESET' })
					}}>{t('actions.close')}</Button
				>
				<Button type="submit" disabled={!enabled}>{action('add', 'tag')}</Button>
			</div>
		</form>
	{/if}
</Dialog>

<style>
	.tags,
	form {
		display: grid;
		gap: var(--dui-spacing-sm);
		margin-block: var(--dui-spacing-sm);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: end;
		gap: var(--dui-spacing-sm);
	}
</style>
