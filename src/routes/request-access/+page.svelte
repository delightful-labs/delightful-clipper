<script>
  import AccountLinkingConsumer from '$components/AccountLinkingConsumer.svelte'
  import { mainService } from '$lib/machines/mainMachine'
</script>

<!--@todo: handle redirect after success-->
{#if $mainService.value === 'unauthenticated'}
  <AccountLinkingConsumer />
{/if}