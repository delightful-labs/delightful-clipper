<script lang="ts">
 import Library from '../lib/integrations/Library.svelte'
 import {useLibrary} from '../lib/runtime/library-context.js'
 const runtime=useLibrary()
</script>
{#if runtime.actor}
 {#key runtime.actor}<Library actor={runtime.actor} gatewayEnabled={runtime.gatewayEnabled}/>{/key}
{/if}
