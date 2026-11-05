<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { StatusMessage } from 'delightful-ui'
	import { libraryMachine, selectLibraryView } from '../machines/capture/library.js'
	import LibrarySearch from '../components/library/LibrarySearch.svelte'
	import LibraryFilters from '../components/library/LibraryFilters.svelte'
	import ArticleList from '../components/library/ArticleList.svelte'
	import ArticleTags from './ArticleTags.svelte'
	import { t } from '../localization/index.js'
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
		<h2 bind:this={heading} tabindex="-1">{t('library.heading')}</h2>
		<LibrarySearch
			query={capture.query}
			enabled={view.search.enabled}
			message={view.search.message}
			canRetry={view.search.canRetry}
			onquery={(query) => actor.send({ type: 'QUERY', query })}
			onretry={() => actor.send({ type: 'RETRY_SEARCH' })}
		/>
		<LibraryFilters
			view={capture.view}
			favorites={capture.favorites}
			tags={view.tags}
			selectedTags={capture.selectedTags}
			onfilter={(view, favorites) => actor.send({ type: 'FILTER', view, favorites })}
			ontagfilter={(keys) => actor.send({ type: 'TAG_FILTER', keys })}
		/>
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
	section {
		margin-block: 1.5rem;
	}
</style>
