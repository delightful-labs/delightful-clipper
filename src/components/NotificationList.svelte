<script>
  import Notification from '$components/Notification.svelte'

  export let notifications
</script>

{#if $notifications}
  <ul>
    {#each $notifications as notification}
      <Notification {notification} />
    {/each}
  </ul>
{/if}

<style>
  ul {
    position: fixed;
    bottom: 0;
    left: 0;
  }
</style>