<script lang="ts">
	import { onMount } from 'svelte'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { StatusMessage } from 'delightful-ui'
	import { libraryMachine, selectLibraryView } from '../machines/capture/library.js'
	import { normalizedSource } from '../capture/source.js'
	import { t } from '../localization/index.js'
	import ReaderView from '../components/reader/ReaderView.svelte'
	import {
		readerHeadings,
		footnoteFromClick,
		type ReaderHeading,
		type ReaderFootnote
	} from '../reader/structure.js'
	import type { ReaderExperienceEvent } from '../machines/reader/experience.js'
	let { actor, id }: { actor: ActorRefFrom<typeof libraryMachine>; id: string } = $props()
	let snapshot = $state<SnapshotFrom<typeof libraryMachine>>()
	let headings = $state<ReaderHeading[]>([])
	let footnote = $state<ReaderFootnote>()
	const footnoteId = $props.id()
	const view = $derived(selectLibraryView(snapshot))
	const reading = $derived(view.readerExperience)
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
	function send(event: ReaderExperienceEvent) {
		actor.send({ type: 'READER_EVENT', event })
	}
	function ready(node: HTMLElement) {
		if (reader?.kind !== 'available') return
		headings = readerHeadings(node)
		const scroller = node.closest('main')
		if (scroller)
			send({
				type: 'ATTACH',
				documentId: reader.document.snapshotId,
				root: node,
				scroller
			})
	}
	function release() {
		send({ type: 'DETACH' })
		headings = []
		footnote = undefined
	}
	function showFootnote(event: MouseEvent, root: HTMLElement) {
		const note = footnoteFromClick(root, event)
		const popover = document.getElementById(footnoteId)
		if (!note || !popover?.showPopover) return
		event.preventDefault()
		footnote = note
		popover.showPopover({ source: note.trigger })
	}
	function closeFootnote() {
		footnote?.trigger.focus()
		footnote = undefined
	}
	onMount(() => {
		const subscription = actor.subscribe((value) => (snapshot = value))
		actor.send({ type: 'OPEN', id })
		snapshot = actor.getSnapshot()
		return () => {
			release()
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
{#if reader?.kind === 'available'}
	<ReaderView
		title={reader.document.title}
		asset={reader.asset}
		imageViews={view.imageViews}
		onretryimage={(id) => actor.send({ type: 'RETRY_IMAGE', id })}
		onimageerror={(id, url) => actor.send({ type: 'IMAGE_ERROR', id, url })}
		text={reader.text}
		sourceUrl={originalUrl}
		preferences={reading.preferences}
		progress={reading.progress[reader.document.snapshotId] ?? 0}
		focused={reading.focused}
		enabled={reading.enabled}
		canOrganize={view.canOrganize}
		trashed={article?.trashed === true}
		archived={article?.status === 'archive'}
		{headings}
		{footnote}
		{footnoteId}
		message={reading.message}
		readingMessage={view.readerMessage}
		onchange={(change) => send({ type: 'CHANGE', change })}
		onfocus={() => send({ type: 'FOCUS' })}
		onshowcontrols={() => send({ type: 'SHOW_CONTROLS' })}
		onreflow={() => send({ type: 'REFLOW' })}
		onarchive={() =>
			actor.send({
				type: 'ORGANIZE',
				request: { id: article?.id ?? id, field: 'status', value: 'archive' }
			})}
		onrestore={() =>
			actor.send({
				type: 'ORGANIZE',
				request: { id: article?.id ?? id, field: 'trashed', value: false }
			})}
		onready={ready}
		onrelease={release}
		onlink={showFootnote}
		onfootnoteclose={closeFootnote}
		onfullnote={() => {
			footnote = undefined
			document.getElementById(footnoteId)?.hidePopover()
		}}
	/>
{:else if view.readerMessage}<StatusMessage {...view.readerMessage} />{/if}
