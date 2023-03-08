<script>
  import { fly } from 'svelte/transition'

  /**
   * @type {*}
   */
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
    on:mouseenter={() => notification.send("MOUSEOVER")}
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
    background-color: var(--color__background);
    font-family: var(--font-family__secondary);
    list-style: none;
    color: #262626;
    border: 2px solid;
    padding: var(--spacing__xs);
  }

  li:hover button {
    animation-play-state: paused;
  }

  .success {
    background-color: var(--color__success);
  }

  .warning {
    background-color: var(--color__warning);
  }

  .error {
    background-color: var(--color__error);
  }

  button {
    --a: 0deg;
    width: 44px;
    border-radius: 50%;
    background-image: conic-gradient(rgba(0,0,0, .5), rgba(0,0,0, .5) var(--a), rgba(0,0,0, .2) var(--a));
    animation: a calc(var(--timer, 5000) * 1ms) linear;
  }
</style>
