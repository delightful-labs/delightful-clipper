<script>
	import '../lib/assets/global.css'
  import { mainService } from '$lib/machines/mainMachine'
  import { useSelector } from '@xstate/svelte'
  import RegistrationForm from '$components/RegistrationForm.svelte'
  import { userSettings } from '$lib/stores'
  import Header from '$components/Header.svelte'
  
  const userState = useSelector(mainService, (state) => state.value)

  // Anytime the store changes, update the local storage value.
  $: {
		const storedSettings = localStorage.userSettings

		if (storedSettings) {
			userSettings.update(() => JSON.parse(storedSettings))
		}

		userSettings.subscribe((value) => {
			localStorage.userSettings = JSON.stringify(value)
		})
	}

  $: if($mainService.context.db) console.log($mainService.context.db)
</script>

<Header />

<!--@TODO: Move auth stuff to separate component-->
{#if $userState === 'unauthenticated'}
  <button 
    on:click={()=> mainService.send({ type: 'REGISTER'})}
    disabled={!$mainService.can({type: 'REGISTER'})}
  >Register</button>

  <p>If you are a new user, you can register.</p>
  <p>If you are an existing user, you can use the device or browser where you are signed in to find the instructions on how to connect this device.</p>
{/if}

<!--@TODO: Registration could easily be a page instead of a component-->
{#if $userState === 'registering'}
  <RegistrationForm />
{/if}

<slot />