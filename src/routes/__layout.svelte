<script>
  import '../assets/global.css'
  import { browser } from '$app/env'
  import { userSettings, send, state } from '$lib/stores'
  import ParseForm from '$lib/components/ParseForm.svelte'
  import SettingsPanel from '$lib/components/SettingsPanel.svelte'
  import DetailsSummary from '$lib/components/DetailsSummary.svelte'
  import LoadingSpinner from '$lib/components/LoadingSpinner.svelte'

  $: if (browser) console.log($state)

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
  <DetailsSummary title={'Add'}>
    <ParseForm />
  </DetailsSummary>
  <SettingsPanel />
</header>

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
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

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
