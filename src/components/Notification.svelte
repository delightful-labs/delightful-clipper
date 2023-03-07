<script>
  export let notification

  console.log($notification)
</script>

{#if !$notification.matches('inactive')}
  <li>Notification</li>
{/if}
