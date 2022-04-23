<script>
  import '../assets/global.css'
  import { browser } from '$app/env'
  import { db, fs, fissionState, wn, userSettings, send, state } from '$lib/stores'
  //import { onMount } from 'svelte'

  $: console.log($state)

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
  }

  const signin = () => send('AUTHORIZE')
</script>

<p>Status: {$state?.value}</p>
{#if $state?.value === 'unauthorized'}
  <button on:click={signin}>Sign in with Fission</button>
{/if}

<slot />
