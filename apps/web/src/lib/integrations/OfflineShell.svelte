<script lang="ts">
	import { machineDiagnostics } from '../diagnostics/inspect.js'
	import { onMount } from 'svelte'
	import { dev } from '$app/env'
	import { createActor, type SnapshotFrom } from 'xstate'
	import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
	import { Button, StatusMessage } from 'delightful-ui'
	import {
		createShellRegistrationMachine,
		selectShellView
	} from '../machines/offline/registration.js'
	import { observeShell } from '../offline/browser.js'
	import { t } from '../localization/index.js'
	let { onAdmission }: { onAdmission: () => void } = $props()
	let snapshot = $state<SnapshotFrom<ReturnType<typeof createShellRegistrationMachine>>>()
	let retry = () => {}
	const view = $derived(selectShellView(snapshot))

	onMount(() => {
		if (dev) {
			onAdmission()
			return
		}
		const machine = createShellRegistrationMachine({
			register: () =>
				'serviceWorker' in navigator
					? navigator.serviceWorker.register('/service-worker.js', {
							type: 'module',
							updateViaCache: 'none'
						})
					: Promise.resolve(undefined),
			observe: observeShell
		})
		const actor = createActor(machine, { ...machineDiagnostics })
		const subscription = actor.subscribe((next) => {
			snapshot = next
			if (selectShellView(next).admitted) onAdmission()
		})
		retry = () => actor.send({ type: 'RETRY' })
		actor.start()
		return () => {
			subscription.unsubscribe()
			stopAfterShutdown(actor)
		}
	})
</script>

{#if !dev}
	{#if view.message}<StatusMessage {...view.message} />{/if}
	{#if view.canRetry}<Button type="button" onclick={() => retry()}>{t('actions.retry')}</Button
		>{/if}
{/if}
