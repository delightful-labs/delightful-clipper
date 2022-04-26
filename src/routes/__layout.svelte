<script>
  //import '../assets/global.css'
  import { browser } from '$app/env'
  import { userSettings, send, state } from '$lib/stores'
  import ParseForm from '$lib/components/ParseForm.svelte'
  import SettingsPanel from '$lib/components/SettingsPanel.svelte'

  //$: console.log($state)

  const initialiseUserSettingNumber = (settingTitle, settingStore) => {
    const storedSetting = localStorage[settingTitle]

    if (storedSetting) {
      settingStore.update(() => parseInt(storedSetting))
    }

    settingStore.subscribe((value) => {
      localStorage[settingTitle] = String(value)
    })
  }

  // Anytime the store changes, update the local storage value.
  $: if (browser) {
    for (const [key, value] of Object.entries(userSettings)) {
      initialiseUserSettingNumber(key, value)
    }
  }

  $: if (browser) {
    send('IN_BROWSER')
    window.addEventListener('offline', () => send('OFFLINE'))
    window.addEventListener('online', () => send('ONLINE'))
  }

  const signin = () => send('AUTHORIZE')
</script>

<header>
  <a href="/">Home</a>
  <details>
    <summary>Add</summary>
    <ParseForm />
  </details>
  <SettingsPanel />
</header>

<p>Status: {JSON.stringify($state?.value)}</p>
{#if $state?.value === 'unauthorized'}
  <button on:click={signin}>Sign in with Fission</button>
{/if}

{#if $state.matches('fileSystem.initialized')}
  <slot />
{:else}
  <p>Loading...</p>
{/if}

<style>
  header {
    display: flex;
    justify-content: space-between;
    align-self: center;
  }
</style>
