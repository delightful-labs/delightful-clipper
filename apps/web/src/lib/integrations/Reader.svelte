<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { libraryMachine, selectLibraryView } from '../machines/capture/library.js'
	import { normalizedSource } from '../capture/source.js'
	import { StatusMessage, Button } from 'delightful-ui'
	import { t, action } from '../localization/index.js'
	import SavedContent from './SavedContent.svelte'
	let { actor, id }: { actor: ActorRefFrom<typeof libraryMachine>; id: string } = $props()
	let snapshot = $state<SnapshotFrom<typeof libraryMachine>>()
	const view = $derived(selectLibraryView(snapshot))
	const reader = $derived(snapshot?.context.reader)
	const article = $derived(
		snapshot?.context.rows.find((row) => row.id === id || row.contentId === id)
	)
	const originalUrl = $derived.by(() => {
		if (reader?.kind !== 'available' || !reader.source) return undefined
		try {
			return normalizedSource(reader.source.finalUrl)
		} catch {
			return undefined
		}
	})
	onMount(() => {
		const subscription = actor.subscribe((value) => (snapshot = value))
		actor.send({ type: 'OPEN', id })
		snapshot = actor.getSnapshot()
		return () => {
			subscription.unsubscribe()
			actor.send({ type: 'CLOSE_READER' })
			snapshot = undefined
		}
	})
</script>

<svelte:head
	><title>{reader?.kind === 'available' ? reader.document.title : t('reader.heading')}</title
	></svelte:head
>
<nav><a href="/">{action('open', 'library')}</a></nav>
<section aria-label={t('reader.heading')}>
	{#if reader?.kind === 'available'}
		<article>
			<h2>{reader.document.title}</h2>
			{#if article?.trashed}<Button
					appearance="flat"
					disabled={!view.canOrganize}
					onclick={() =>
						actor.send({
							type: 'ORGANIZE',
							request: { id: article!.id, field: 'trashed', value: false }
						})}>{action('restore', 'article')}</Button
				>{/if}
			{#if originalUrl}<a href={originalUrl} rel="noreferrer">{action('open', 'original')}</a>{/if}
			{#if view.readerMessage}<StatusMessage {...view.readerMessage} />{/if}
			<SavedContent asset={reader.asset} text={reader.text} sourceUrl={originalUrl} />
		</article>
	{:else if view.readerMessage}<StatusMessage {...view.readerMessage} />{/if}
</section>
