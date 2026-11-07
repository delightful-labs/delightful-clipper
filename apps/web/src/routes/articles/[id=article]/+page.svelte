<script lang="ts">
	import { page } from '$app/state'
	import Reader from '../../../lib/integrations/Reader.svelte'
	import { useWorkerLibrary } from '../../../lib/runtime/worker/context.js'
	const runtime = useWorkerLibrary()
</script>

{#if runtime.actor}
	{#key runtime.actor}{#key page.params.id}<Reader
				actor={runtime.actor}
				id={page.params.id ?? ''}
			/>{/key}{/key}
{/if}
