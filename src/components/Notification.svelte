<script>
  import { fly } from 'svelte/transition'

  export let notification

  const types = {
    warning: 'warning',
    error: 'error',
    success: 'success'
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
    <button 
      style="--timer: {$notification.context.timeout || 5000};"
      on:click={() => notification.send("DISMISS")}
    >X</button>
  </li>
{/if}

<style>
  @property --a {
    syntax: '<angle>';
    inherits: false;
    initial-value: 90deg;
  }

  @keyframes a{
    from {
      --a: 360deg;
    }

    to {
      --a: 0deg;
    }
  }

  li {
    list-style: none;
  }

  .success {
    background-color: greenyellow;
  }

  .warning {
    background-color: darkkhaki;
  }

  .error {
    background-color: red;
  }

  button {
    --a: 90deg;
    width: 44px;
    border-radius: 50%;
    background-image: conic-gradient(red, red var(--a), blue var(--a));
    animation: a calc(var(--timer, 5000) * 1ms) linear infinite alternate;
  }
</style>
