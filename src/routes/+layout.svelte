<script>
	import '../lib/assets/global.css'
  import { mainService } from '$lib/machines/main'
  import { useSelector } from '@xstate/svelte'
  import { userSettings } from '$lib/stores'
  import Header from '$components/Header.svelte'
  import NotificationList from '$components/NotificationList.svelte'
  import { updated } from '$app/stores';

  updated.subscribe(async (value) => {
    if (value) {
      window.location.reload()
    }
  })

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

</script>

<svelte:head>
	<title>Delightful Clipper</title>
</svelte:head>

<Header />

<main>

  <slot />

  <NotificationList {notifications} />
</main>
