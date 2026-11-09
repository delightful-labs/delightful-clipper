<script lang="ts">
	import { onMount } from 'svelte'
	import type { LibraryClient } from '../runtime/worker/client.js'
	import type { LibraryRender } from '../runtime/worker/views.js'
	import PageNavigation from '../components/navigation/PageNavigation.svelte'
	import { Button, StatusMessage } from 'delightful-ui'
	import LibrarySearch from '../components/library/LibrarySearch.svelte'
	import LibraryFilters from '../components/library/LibraryFilters.svelte'
	import LibraryFilterPopovers from '../components/library/LibraryFilterPopovers.svelte'
	import ArticleList from '../components/library/ArticleList.svelte'
	import ArticleTags from './ArticleTags.svelte'
	import { action, t } from '../localization/index.js'
	let {
		actor,
		gatewayEnabled
	}: {
		actor: LibraryClient
		gatewayEnabled?: boolean
	} = $props()
	let snapshot = $state<LibraryRender>()
	let heading = $state<HTMLHeadingElement>()
	let tagTrigger: HTMLElement | undefined
	let tagArticleId = $state<string>()
	let tagsOpen = $state(false)
	const capture = $derived(snapshot?.filters)
	const view = $derived(snapshot?.view ?? actor.getView().view)

	onMount(() => {
		snapshot = actor.getView()
		const subscription = actor.subscribe((next) => (snapshot = next))
		return () => subscription.unsubscribe()
	})
</script>

{#if capture}
	<section aria-label={t('library.heading')}>
		<div class="library-header">
			<PageNavigation />
			<h1 bind:this={heading} tabindex="-1">{t('library.heading')}</h1>
			<LibraryFilterPopovers
				searchLabel={action('search', 'article', 2)}
				onsearch={() => actor.send({ type: 'SEARCH_OPEN' })}
				filtersLabel={action('filter', 'article', 2)}
			>
				{#snippet search()}
					<LibrarySearch
						query={capture.query}
						enabled={view.search.enabled}
						onquery={(query) => actor.send({ type: 'QUERY', query })}
					/>
				{/snippet}
				{#snippet filters()}
					<LibraryFilters
						view={capture.view}
						favorites={capture.favorites}
						tags={view.tags}
						selectedTags={capture.selectedTags}
						onfilter={(view, favorites) => actor.send({ type: 'FILTER', view, favorites })}
						ontagfilter={(keys) => actor.send({ type: 'TAG_FILTER', keys })}
					/>
				{/snippet}
			</LibraryFilterPopovers>
		</div>
		{#if view.search.message}<StatusMessage {...view.search.message} />{/if}
		{#if view.search.canRetry}<Button
				type="button"
				onclick={() => actor.send({ type: 'RETRY_SEARCH' })}>{t('actions.retry')}</Button
			>{/if}
		{#if view.organizationMessage}<StatusMessage {...view.organizationMessage} />{/if}
		{#if view.listMessage}<StatusMessage {...view.listMessage} />{/if}
		{#if view.emptyMessage}<p>{view.emptyMessage.text}</p>{/if}
		<ArticleList
			rows={view.rows}
			hasMore={snapshot?.hasMore ?? false}
			onmore={() => actor.more()}
			resetKey={JSON.stringify([
				capture.query,
				capture.view,
				capture.favorites,
				capture.selectedTags
			])}
			readable={view.readable}
			enabled={view.canOrganize}
			onorganize={(request) => actor.send({ type: 'ORGANIZE', request })}
			onretry={(id) => actor.send({ type: 'RETRY', id })}
			ontags={(row, trigger) => {
				tagTrigger = trigger
				tagArticleId = row.id
				actor.editTags(row.id)
				tagsOpen = true
			}}
			onemptyfocus={() => heading?.focus()}
		/>
	</section>
	<ArticleTags
		{actor}
		row={snapshot?.tagArticle && snapshot.tagArticle.id === tagArticleId
			? snapshot.tagArticle
			: view.rows.find((row) => row.id === tagArticleId)}
		tags={view.tags}
		enabled={view.canOrganize}
		bind:open={tagsOpen}
		onclose={() => {
			actor.editTags(undefined)
			if (!tagTrigger?.isConnected) heading?.focus()
		}}
	/>
{/if}

<style>
	.library-header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		min-inline-size: 0;
	}

	.library-header h1 {
		margin: 0;
	}

	section {
		min-inline-size: 0;
	}
</style>
