<script lang="ts">
	import { StatusMessage } from 'delightful-ui'
	import type { WorkflowMessage } from '../contracts/feedback.js'
	let { message }: { message: WorkflowMessage | undefined } = $props()
</script>

{#if message}<StatusMessage compact {...message} />{/if}
