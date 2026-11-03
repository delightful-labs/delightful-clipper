<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { articleHref, isArticleId } from '../reader/routes.js'
	import { libraryMachine } from '../machines/capture/library.js'
	import { Button, StatusMessage, InputText } from 'delightful-ui'
	import { t, action } from '../localization/index.js'
	let {
		actor,
		gatewayEnabled
	}: { actor: ActorRefFrom<typeof libraryMachine>; gatewayEnabled: boolean } = $props()
	let snapshot = $state<SnapshotFrom<typeof libraryMachine>>()
	let url = $state('')
	const capture = $derived(snapshot?.context)
	const canAdd = $derived(gatewayEnabled && snapshot?.can({ type: 'ADD', url }))
	const sync = $derived(capture?.sync[capture.captureId])

	const feedback = $derived(
		capture?.failure === 'sourceTooLarge'
			? 'capture.errors.source_too_large'
			: capture?.failure === 'invalidUrl'
				? 'capture.errors.invalid_url'
				: capture?.failure === 'sessionUnavailable'
					? 'capture.errors.session_unavailable'
					: capture?.failure === 'rateLimited'
						? 'capture.errors.rate_limited'
						: 'capture.status.failed'
	)
	onMount(() => {
		snapshot = actor.getSnapshot()
		url = snapshot.context.url
		const subscription = actor.subscribe((next) => (snapshot = next))
		return () => {
			subscription.unsubscribe()
			url = ''
		}
	})
</script>

{#if capture}
	<section aria-label={action('add', 'link')}>
		<h2>{action('add', 'link')}</h2>
		{#if !gatewayEnabled}<StatusMessage text={t('capture.disabled')} />{/if}
		<form
			onsubmit={(event) => {
				event.preventDefault()
				actor.send({ type: 'ADD', url })
			}}
		>
			<InputText
				label={t('capture.url_label')}
				id="article-url"
				name="url"
				type="url"
				bind:value={url}
				required
				maxlength={8192}
				autocomplete="url"
				disabled={!canAdd}
			/>
			<Button type="submit" disabled={!canAdd}>{action('add', 'link')}</Button>
		</form>
		{#if snapshot?.matches({ running: { capture: 'preparing' } })}<StatusMessage
				text={t('capture.status.pending')}
			/>{/if}
		{#if snapshot?.matches({ running: { capture: 'saving' } })}<StatusMessage
				text={t('capture.status.saving')}
			/>{/if}
		{#if snapshot?.matches({ running: { capture: 'failed' } })}<StatusMessage
				variant="error"
				text={t(feedback)}
			/>{/if}
		{#if snapshot?.can({ type: 'CANCEL' })}<Button
				type="button"
				onclick={() => actor.send({ type: 'CANCEL' })}>{t('actions.cancel')}</Button
			>{/if}
		{#if snapshot?.matches({ running: { capture: 'saveFailed' } })}<StatusMessage
				variant="error"
				text={t('capture.status.save_failed')}
			/>{/if}
		{#if snapshot?.matches({ running: { capture: 'canceled' } })}<StatusMessage
				text={t('capture.status.canceled')}
			/>{/if}
		{#if snapshot?.matches({ running: { capture: 'duplicate' } })}<StatusMessage
				text={t('capture.status.duplicate')}
			/>{/if}
		{#if snapshot?.matches({ running: { capture: 'uncertain' } })}<StatusMessage
				variant="error"
				text={t('capture.status.unknown')}
			/>{/if}
		{#if snapshot?.matches({ running: { capture: 'saved' } })}<StatusMessage
				variant={sync === 'rejected' ? 'error' : 'info'}
				text={t(
					sync === 'accepted'
						? 'capture.status.synced'
						: sync === 'rejected'
							? 'capture.status.rejected'
							: 'capture.status.saved'
				)}
			/>{/if}
		{#if snapshot?.matches( { running: { capture: 'saved' } } ) || snapshot?.matches( { running: { capture: 'duplicate' } } ) || snapshot?.matches( { running: { capture: 'uncertain' } } ) || snapshot?.matches( { running: { capture: 'canceled' } } )}
			{#if isArticleId(capture.captureId)}<a href={articleHref(capture.captureId)}
					>{action('open', 'saved_article')}</a
				>{/if}
		{/if}
	</section>
	<section aria-label={t('library.heading')}>
		<h2>{t('library.heading')}</h2>
		{#if capture.listFailed}<StatusMessage variant="error" text={t('library.list_failed')} />{/if}
		{#if !capture.rows.length}<p>{t('library.empty')}</p>{/if}
		<ul>
			{#each capture.rows as row (row.id)}<li>
					{#if capture.writing && row.id === capture.captureId}{row.title}{:else}<a
							href={articleHref(row.id)}>{row.title}</a
						>{/if}{#if capture.sync[row.id]}<span
							>{t(
								capture.sync[row.id] === 'rejected'
									? 'capture.status.rejected'
									: capture.sync[row.id] === 'accepted'
										? 'capture.status.synced'
										: 'library.sync_pending'
							)}</span
						>{/if}
				</li>{/each}
		</ul>
	</section>
{/if}

<style>
	section {
		margin-block: 1.5rem;
	}

	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	li {
		margin-block: 0.75rem;
	}

	li span {
		display: block;
		font-size: 0.875rem;
	}
</style>
