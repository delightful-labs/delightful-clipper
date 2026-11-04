<script lang="ts">
	import { createActor } from 'xstate'
	import type { ActorRefFrom, SnapshotFrom } from 'xstate'
	import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
	import { Button, StatusMessage } from 'delightful-ui'
	import { useLibrary } from '../../web/src/lib/runtime/library-context.js'
	import { action, t } from '../../web/src/lib/localization/index.js'
	import { createClipMachine } from './clip-machine.js'
	import { captureKey } from './protocol.js'
	import { extractSource } from './worker.js'
	const library = useLibrary()
	let actor = $state<ActorRefFrom<ReturnType<typeof createClipMachine>>>()
	let snapshot = $state<SnapshotFrom<ReturnType<typeof createClipMachine>>>()
	const id = location.hash.slice(1)
	$effect(() => {
		const owner = library.actor
		if (!owner) return
		const bound = owner.getSnapshot().context.capability
		if (!bound) return
		const machine = createClipMachine({
			library: owner,
			accountId: bound.libraryId,
			current: bound.isCurrent,
			read: (id) => chrome.runtime.sendMessage({ type: 'CAPTURE', id }),
			extract: extractSource,
			issue: async (capture, accountId) => {
				await chrome.storage.local.set({
					[captureKey(capture.id)]: { ...capture, accountId, phase: 'issued' }
				})
			},
			remove: (id) => chrome.storage.local.remove(captureKey(id)),
			dismiss: () => window.close()
		})
		const next = createActor(machine, { input: { id } })
		actor = next
		const subscription = next.subscribe((value) => {
			snapshot = value
		})
		next.start()
		return () => {
			subscription.unsubscribe()
			stopAfterShutdown(next)
		}
	})
</script>

<section aria-label={action('save', 'article')}>
	<h2>{action('save', 'article')}</h2>
	{#if snapshot?.context.capture}<p>{snapshot.context.capture.url}</p>{/if}
	{#if snapshot?.context.message}<StatusMessage {...snapshot.context.message} />{/if}
	{#if snapshot?.can({ type: 'SAVE' })}<Button onclick={() => actor?.send({ type: 'SAVE' })}
			>{action('save', 'article')}</Button
		>{/if}
	{#if snapshot?.can({ type: 'CLOSE' })}<Button onclick={() => actor?.send({ type: 'CLOSE' })}
			>{t('actions.close')}</Button
		>{/if}
	<p>{t('capture.text_only')}</p>
	<a href={__CLIPPER_WEB__} target="_blank" rel="noreferrer">{action('open', 'library')}</a>
</section>
