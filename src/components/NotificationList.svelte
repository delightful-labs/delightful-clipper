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
    padding: 0;
    margin: 0;
    position: fixed;
    bottom: 0;
    left: 0;
    display: grid;
    gap: 1rem;
  }
</style>