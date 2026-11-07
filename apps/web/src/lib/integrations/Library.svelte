<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { Button, StatusMessage } from 'delightful-ui'
	import { libraryMachine, selectLibraryView } from '../machines/capture/library.js'
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
		actor: ActorRefFrom<typeof libraryMachine>
		gatewayEnabled: boolean
	} = $props()
	let snapshot = $state<SnapshotFrom<typeof libraryMachine>>()
	let heading = $state<HTMLHeadingElement>()
	let tagTrigger: HTMLElement | undefined
	let tagArticleId = $state<string>()
	let tagsOpen = $state(false)
	const capture = $derived(snapshot?.context)
	const view = $derived(selectLibraryView(snapshot, gatewayEnabled))

	onMount(() => {
		snapshot = actor.getSnapshot()
		const subscription = actor.subscribe((next) => (snapshot = next))
		return () => subscription.unsubscribe()
	})
</script>

{#if capture}
	<section aria-label={t('library.heading')}>
		<div class="library-header">
			<h2 bind:this={heading} tabindex="-1">{t('library.heading')}</h2>
			<LibraryFilterPopovers
				searchLabel={action('search', 'article', 2)}
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
			readable={view.readable}
			enabled={view.canOrganize}
			onorganize={(request) => actor.send({ type: 'ORGANIZE', request })}
			onretry={(id) => actor.send({ type: 'RETRY', id })}
			ontags={(row, trigger) => {
				tagTrigger = trigger
				tagArticleId = row.id
				tagsOpen = true
			}}
			onemptyfocus={() => heading?.focus()}
		/>
	</section>
	<ArticleTags
		{actor}
		row={capture.rows.find((row) => row.id === tagArticleId)}
		tags={view.tags}
		enabled={view.canOrganize}
		bind:open={tagsOpen}
		onclose={() => {
			if (!tagTrigger?.isConnected) heading?.focus()
		}}
	/>
{/if}

<style>
	.library-header {
		display: flex;
		align-items: center;
		gap: var(--dui-spacing-md);
		min-inline-size: 0;
	}

	section {
		margin-block: 1.5rem;
	}
</style>
