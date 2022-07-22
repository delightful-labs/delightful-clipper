<script>
  import '../assets/global.css'
  import { browser } from '$app/env'
  import { userSettings, send, state } from '$lib/stores'
  import Header from '$lib/components/Header.svelte'
  import LoadingSpinner from '$lib/components/LoadingSpinner.svelte'

  $: if (browser) console.log($state)

  // Anytime the store changes, update the local storage value.
  $: if (browser) {
    const storedSettings = localStorage.userSettings

    if (storedSettings) {
      userSettings.update(() => JSON.parse(storedSettings) )
    }

    userSettings.subscribe((value) => {
      localStorage.userSettings = JSON.stringify(value)
    })
  }

  $: if (browser) {
    send('IN_BROWSER')
    window.addEventListener('offline', () => send('OFFLINE'))
    window.addEventListener('online', () => send('ONLINE'))
  }

  const signin = () => send('AUTHORIZE')
</script>

<Header />

<main>
  {#if $state?.value.fileSystem === 'unauthorized'}
    <button on:click={signin}>Sign in with Fission</button>
  {/if}

  {#if $state.matches('fileSystem.initialized')}
    <slot />
  {:else}
    <div class="loading-wrapper">
      <LoadingSpinner text={'Loading articles'} />
    </div>
  {/if}
</main>

<style>
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .loading-wrapper {
    display: grid;
    flex: 1;
  }
</style>
