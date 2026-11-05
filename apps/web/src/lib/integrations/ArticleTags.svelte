<script lang="ts">
	import type { ActorRefFrom } from 'xstate'
	import { Button, Checkbox, Dialog, InputText } from 'delightful-ui'
	import { libraryMachine } from '../machines/capture/library.js'
	import type { LibraryArticle } from '../contracts/articles.js'
	import type { Tag } from '../capture/tags.js'
	import { isValidTagName } from '../capture/tags.js'
	import { action, noun, t } from '../localization/index.js'
	let {
		actor,
		row,
		tags,
		enabled,
		open = $bindable(false)
	}: {
		actor: ActorRefFrom<typeof libraryMachine>
		row: LibraryArticle | undefined
		tags: Tag[]
		enabled: boolean
		open?: boolean
	} = $props()
	let name = $state('')
	const valid = $derived(isValidTagName(name))
</script>

<Dialog heading={noun('tag', 2)} bind:open closedby="any">
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
			onsubmit={(event) => {
				event.preventDefault()
				if (valid && enabled) {
					actor.send({
						type: 'ORGANIZE',
						request: { id: article.id, field: 'tag', value: name, assigned: true }
					})
					name = ''
				}
			}}
		>
			<InputText
				label={noun('tag')}
				bind:value={name}
				required
				maxlength={256}
				disabled={!enabled}
			/>
			<div class="actions">
				<Button
					type="button"
					onclick={() => {
						open = false
						name = ''
					}}>{t('actions.close')}</Button
				>
				<Button type="submit" disabled={!valid || !enabled}>{action('add', 'tag')}</Button>
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
