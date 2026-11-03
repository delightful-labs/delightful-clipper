<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { articleHref, isArticleId } from '../reader/routes.js'
	import { libraryMachine, selectLibraryView } from '../machines/capture/library.js'
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
	const view = $derived(selectLibraryView(snapshot, gatewayEnabled))

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
		{#if view.disabledMessage}<StatusMessage {...view.disabledMessage} />{/if}
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

		{#if view.captureMessage}<StatusMessage {...view.captureMessage} />{/if}
		{#if snapshot?.can({ type: 'CANCEL' })}<Button
				type="button"
				onclick={() => actor.send({ type: 'CANCEL' })}>{t('actions.cancel')}</Button
			>{/if}
		{#if view.canOpenCapture && isArticleId(capture.captureId)}<a
				href={articleHref(capture.captureId)}>{action('open', 'saved_article')}</a
			>{/if}
	</section>
	<section aria-label={t('library.heading')}>
		<h2>{t('library.heading')}</h2>
		{#if view.listMessage}<StatusMessage {...view.listMessage} />{/if}
		{#if view.emptyMessage}<p>{view.emptyMessage.text}</p>{/if}
		<ul>
			{#each capture.rows as row (row.id)}<li>
					{#if capture.writing && row.id === capture.captureId}{row.title}{:else}<a
							href={articleHref(row.id)}>{row.title}</a
						>{/if}{#if view.syncMessages[row.id]}<span>{view.syncMessages[row.id]?.text}</span>{/if}
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
