<script>
  import { mainService } from '$lib/machines/mainMachine'
	import AccountLinkingProducerForm from '$components/AccountLinkingProducerForm.svelte';

  let username = ''

  $: username = $mainService.context.username


</script>

{#if username}
  <AccountLinkingProducerForm {username} />
{/if}