<script>
  import { mainService } from '$lib/machines/main'
	import AccountLinkingProducerForm from '$components/AccountLinkingProducerForm.svelte'
  import Username from '$lib/schemas/Username'

  let username = Username.parse({})

  $: username = $mainService.context.username

</script>

{#if username.full}
  <AccountLinkingProducerForm {username} />
{:else}
  <p>No username</p>
{/if}