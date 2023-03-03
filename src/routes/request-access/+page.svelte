<script>
  import AccountLinkingConsumer from '$components/AccountLinkingConsumer.svelte'
  import { mainService } from '$lib/machines/mainMachine'

  $: console.log($mainService.value)
</script>

<!--@TODO: only show if not registered-->

{#if $mainService.value === 'unauthenticated'}
  <AccountLinkingConsumer />
{/if}