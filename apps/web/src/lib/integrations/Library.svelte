<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { articleHref } from '../reader/routes.js'
	import { libraryMachine, selectLibraryView } from '../machines/capture/library.js'
	import { Button, StatusMessage, Select, RadioGroup, RadioItem, Heading } from 'delightful-ui'
	import { articleStatuses, libraryViews, isArticleStatus } from '../capture/organization.js'
	import { t, action } from '../localization/index.js'
	let {
		actor,
		gatewayEnabled
	}: { actor: ActorRefFrom<typeof libraryMachine>; gatewayEnabled: boolean } = $props()
	let snapshot = $state<SnapshotFrom<typeof libraryMachine>>()
	const capture = $derived(snapshot?.context)
	const view = $derived(selectLibraryView(snapshot, gatewayEnabled))

	onMount(() => {
		snapshot = actor.getSnapshot()
		const subscription = actor.subscribe((next) => (snapshot = next))
		return () => {
			subscription.unsubscribe()
		}
	})
</script>

{#if capture}
	<section aria-label={t('library.heading')}>
		<h2>{t('library.heading')}</h2>
		<div class="filters">
			<RadioGroup label={t('library.status_label')} value={capture.view}>
				{#each libraryViews as status}
					<RadioItem
						value={status}
						onchange={() =>
							actor.send({ type: 'FILTER', view: status, favorites: capture.favorites })}
						>{t(`library.views.${status}`)}</RadioItem
					>
				{/each}
			</RadioGroup>
			<Button
				type="button"
				aria-pressed={capture.favorites}
				onclick={() =>
					actor.send({ type: 'FILTER', view: capture.view, favorites: !capture.favorites })}
				>{t('library.views.favorites')}</Button
			>
		</div>
		{#if view.organizationMessage}<StatusMessage {...view.organizationMessage} />{/if}
		{#if view.listMessage}<StatusMessage {...view.listMessage} />{/if}
		{#if view.emptyMessage}<p>{view.emptyMessage.text}</p>{/if}
		{#if view.rows.length}
			<ul class="article-list">
				{#each view.rows as row (row.id)}
					<li data-article-id={row.id}>
						<div class="article-header">
							<div class="article-title">
								<Heading level="h3" size="xl">
									{#if view.readable[row.id]}<a href={articleHref(row.id)}>{row.title}</a
										>{:else}{row.title}{/if}
								</Heading>
							</div>
							<div class="organization-controls">
								<Select
									label={t('library.status_label')}
									value={row.status ?? 'inbox'}
									disabled={!view.canOrganize}
									onchange={(event) => {
										const value = event.currentTarget.value
										if (isArticleStatus(value))
											actor.send({
												type: 'ORGANIZE',
												request: { id: row.id, field: 'status', value }
											})
									}}
								>
									{#each articleStatuses as status}
										<option value={status}>{t(`library.views.${status}`)}</option>
									{/each}
								</Select>
								<Button
									type="button"
									appearance="flat"
									aria-pressed={row.favorite === true}
									disabled={!view.canOrganize}
									onclick={() =>
										actor.send({
											type: 'ORGANIZE',
											request: { id: row.id, field: 'favorite', value: !row.favorite }
										})}>{t(row.favorite ? 'library.unfavorite' : 'library.favorite')}</Button
								>
							</div>
						</div>
						{#if !view.readable[row.id]}
							{#if row.url}<a href={row.url} rel="noreferrer">{action('open', 'original')}</a>{/if}
							{#if row.failure}<Button
									type="button"
									onclick={() => actor.send({ type: 'RETRY', id: row.id })}
									>{t('actions.retry')}</Button
								>{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	section {
		margin-block: 1.5rem;
	}

	.filters,
	.organization-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: end;
	}

	.article-list {
		list-style: none;
		margin-block: var(--dui-space-md);
		padding: 0;
		border: 1px solid var(--dui-color-foreground);
	}

	.article-list > li {
		margin: 0;
		padding: var(--dui-spacing-sm);
		border-block-end: 1px solid var(--dui-color-foreground);
	}

	.article-list > li:last-child {
		border-block-end: 0;
	}

	.article-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dui-spacing-sm);
	}

	.article-title {
		flex: 1 1 16rem;
		min-inline-size: 0;
	}
</style>
