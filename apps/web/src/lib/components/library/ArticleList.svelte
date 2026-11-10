<script lang="ts">
	import { tick } from 'svelte'
	import { Button } from 'delightful-ui'
	import { action } from '../../localization/index.js'
	import type { LibraryArticle } from '../../contracts/articles.js'
	import type { OrganizationRequest } from '../../capture/organization.js'
	import ArticleListItem from './ArticleListItem.svelte'
	let {
		rows,
		readable,
		enabled,
		onorganize,
		onretry,
		ontags,
		onemptyfocus,
		resetKey,
		hasMore,
		onmore
	}: {
		rows: LibraryArticle[]
		readable: Record<string, boolean>
		enabled: boolean
		onorganize: (request: OrganizationRequest) => void
		onretry: (id: string) => void
		ontags: (row: LibraryArticle, trigger: HTMLElement) => void
		onemptyfocus: () => void
		hasMore: boolean
		onmore: () => void
		resetKey: string
	} = $props()
	const listId = $props.id()
	let pendingIndex = $state<number>()
	let removedAction = $state<{ id: string; candidates: string[]; trigger: HTMLElement }>()
	$effect(() => {
		if (pendingIndex === undefined || !rows[pendingIndex]) return
		const first = rows[pendingIndex]
		if (!first) return
		pendingIndex = undefined
		void tick().then(() => document.getElementById(listId + '-' + first.id)?.focus())
	})
	$effect(() => {
		void resetKey
		pendingIndex = undefined
		removedAction = undefined
	})

	$effect(() => {
		const pending = removedAction
		if (!pending || rows.some((row) => row.id === pending.id)) return
		if (!pending.trigger.isConnected && document.activeElement === document.body) {
			const next = pending.candidates
				.map((id) => document.getElementById(listId + '-' + id))
				.find((element) => element !== null)
			if (next) next.focus()
			else onemptyfocus()
		}
		removedAction = undefined
	})

	function showNext() {
		pendingIndex = rows.length
		onmore()
	}

	function organize(request: OrganizationRequest, trigger: HTMLElement) {
		const index = rows.findIndex((item) => item.id === request.id)
		removedAction = {
			id: request.id,
			candidates: [...rows.slice(index + 1), ...rows.slice(0, index).reverse()].map(
				(item) => item.id
			),
			trigger
		}
		onorganize(request)
	}
</script>

{#if rows.length}
	<ul id={listId} class="article-list">
		{#each rows as row (row.id)}
			<ArticleListItem
				{row}
				id={listId + '-' + row.id}
				readable={readable[row.id] === true}
				{enabled}
				onorganize={organize}
				ontrash={(trigger) =>
					organize({ id: row.id, field: 'trashed', value: !row.trashed }, trigger)}
				ontags={(trigger) => ontags(row, trigger)}
				onretry={() => onretry(row.id)}
			/>
		{/each}
	</ul>
	{#if hasMore}
		<Button type="button" aria-controls={listId} onclick={showNext}
			>{action('show', 'article', 2)}</Button
		>
	{/if}
{/if}

<style>
	.article-list {
		list-style: none;
		margin-block: var(--dui-space-md);
		padding: 0;
		border: 1px solid var(--dui-color-foreground);
	}
</style>
