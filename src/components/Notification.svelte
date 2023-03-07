<script>
  import { fly } from 'svelte/transition'

  export let notification

  const types = {
    warning: 'warning',
    error: 'error'
  }

</script>

{#if !$notification.matches('inactive')}
  <!-- svelte-ignore a11y-mouse-events-have-key-events -->
  <li 
    on:mouseover={() => notification.send("MOUSEOVER")}
    on:mouseleave={() => notification.send("MOUSELEAVE")}
    class={types[$notification.context.type]}
    transition:fly="{{delay: 250, duration: 300, x: 100, y: 500, opacity: 0.5}}" 
  >
    {$notification.context.message} 
    <button on:click={() => notification.send("DISMISS")}>X</button>
  </li>
{/if}

<style>
  li {
    list-style: none;
  }

  .warning {
    background-color: darkkhaki;
  }

  .error {
    background-color: red;
  }
</style>
