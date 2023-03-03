<script>
  import AccountLinkingConsumer from '$components/AccountLinkingConsumer.svelte'
  import { mainService } from '$lib/machines/main'
</script>

<!--@todo: handle redirect after success-->
{#if $mainService.value === 'unauthenticated'}
  <AccountLinkingConsumer />
{/if}