<script lang="ts">
	import { onMount } from 'svelte'
	import { createActor, type SnapshotFrom } from 'xstate'
	import { StatusMessage } from 'delightful-ui'
	import {
		createConnectionMachine,
		selectConnectionMessage
	} from '../machines/offline/connection.js'
	let snapshot = $state<SnapshotFrom<ReturnType<typeof createConnectionMachine>>>()
	const message = $derived(selectConnectionMessage(snapshot))
	onMount(() => {
		const actor = createActor(
			createConnectionMachine((report) => {
				const update = () => report({ type: navigator.onLine ? 'ONLINE' : 'OFFLINE' })
				window.addEventListener('online', update)
				window.addEventListener('offline', update)
				update()
				return () => {
					window.removeEventListener('online', update)
					window.removeEventListener('offline', update)
				}
			})
		)
		const subscription = actor.subscribe((next) => (snapshot = next))
		actor.start()
		return () => {
			subscription.unsubscribe()
			actor.stop()
		}
	})
</script>

{#if message}<StatusMessage compact {...message} />{/if}
