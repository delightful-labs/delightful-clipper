<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { articleHref } from '../reader/routes.js'
	import { libraryMachine, selectLibraryView } from '../machines/capture/library.js'
	import { Button, StatusMessage, Select, RadioGroup, RadioItem } from 'delightful-ui'
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
		<ul>
			{#each view.rows as row (row.id)}
				{@const rowMessage = view.rowMessages[row.id]}
				<li data-article-id={row.id}>
					{#if view.readable[row.id]}<a href={articleHref(row.id)}>{row.title}</a>{:else}<span
							>{row.title}</span
						>
						{#if row.url}<a href={row.url} rel="noreferrer">{action('open', 'original')}</a>{/if}
						{#if row.failure}<Button
								type="button"
								onclick={() => actor.send({ type: 'RETRY', id: row.id })}
								>{t('actions.retry')}</Button
							>{/if}
					{/if}
					<div class="organization-controls">
						<Select
							label={t('library.status_label')}
							value={row.status ?? 'inbox'}
							disabled={!view.canOrganize}
							onchange={(event) => {
								const value = event.currentTarget.value
								if (isArticleStatus(value))
									actor.send({ type: 'ORGANIZE', request: { id: row.id, field: 'status', value } })
							}}
						>
							{#each articleStatuses as status}
								<option value={status}>{t(`library.views.${status}`)}</option>
							{/each}
						</Select>
						<Button
							type="button"
							aria-pressed={row.favorite === true}
							disabled={!view.canOrganize}
							onclick={() =>
								actor.send({
									type: 'ORGANIZE',
									request: { id: row.id, field: 'favorite', value: !row.favorite }
								})}>{t(row.favorite ? 'library.unfavorite' : 'library.favorite')}</Button
						>
					</div>
					{#if view.organizationMessages[row.id]}<StatusMessage
							{...view.organizationMessages[row.id]!}
						/>{/if}
					{#if rowMessage}<StatusMessage {...rowMessage} />{/if}
					{#if view.syncMessages[row.id]}<span>{view.syncMessages[row.id]?.text}</span>{/if}
				</li>
			{/each}
		</ul>
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
		align-items: center;
	}

	.filters {
		align-items: end;
	}

	li {
		margin-block: 0.75rem;
	}

	li span {
		display: block;
		font-size: 0.875rem;
	}
</style>
