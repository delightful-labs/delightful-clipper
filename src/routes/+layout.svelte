<script>
	import '../lib/assets/global.css'
  import { mainService } from '$lib/machines/main'
  import { useSelector } from '@xstate/svelte'
  import RegistrationForm from '$components/RegistrationForm.svelte'
  import { userSettings } from '$lib/stores'
  import Header from '$components/Header.svelte'
  import Notification from '$components/Notification.svelte'
  
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

  const notifications = useSelector(mainService, (state) => state.context.notifier.state.context.toasts)

  $: console.log($notifications)
</script>

<svelte:head>
	<title>Delightful Clipper</title>
</svelte:head>

<Header />

<main>

  <!--@TODO: Move auth stuff to separate component-->
  {#if $userState === 'unauthenticated'}
    <button 
      on:click={()=> mainService.send({ type: 'REGISTER'})}
      disabled={!$mainService.can({type: 'REGISTER'})}
    >Register</button>

    <p>If you are a new user, you can register.</p>
    <p>If you are an existing user, you can use the device or browser where you are signed in to find the instructions on how to connect this device.</p>
  {/if}

  <slot />

  <!--@TODO: Registration could easily be a page instead of a component-->
  {#if $userState === 'registering'}
    <RegistrationForm />
  {/if}


  {#if $notifications}
    <ul>
      {#each $notifications as notification}
        <Notification {notification} />
      {/each}
    </ul>
  {/if}

  <button on:click={()=> mainService.send({ type: 'NOTIFY'})}>Notify</button>
</main>