<script>
	import { mainService } from '$lib/machines/main'
	import { Details } from 'delightful-ui'
	import { beforeNavigate } from '$app/navigation'

	let opened = false

	beforeNavigate(()=> opened = false)

	const eraseDb = async () => {
		let text = 'Delete database?\nThis cannot be undone'
		if (confirm(text) == true) {
			mainService.send({type: 'ERASE_DATABASE'})
		}
	}
</script>

<Details title={'Settings'} bind:opened={opened} >
		<button on:click={() => eraseDb()}>Erase Database</button>
		<a href="/delegate-access">Connect another device</a>
</Details>
