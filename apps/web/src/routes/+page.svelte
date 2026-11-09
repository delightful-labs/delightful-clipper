<script lang="ts">
	import Library from '../lib/integrations/Library.svelte'
	import { useWorkerLibrary } from '../lib/runtime/worker/context.js'
	const runtime = useWorkerLibrary()
</script>

{#if runtime.actor}
	{#key runtime.actor}<Library actor={runtime.actor} />{/key}
{/if}
