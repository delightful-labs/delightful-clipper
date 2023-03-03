<script>
	import { mainService } from '$lib/machines/main'
	import { userSettings } from '$lib/stores'
	import Form from 'svelte-json-schema-to-form/package/Form.svelte'
	import { Details } from 'delightful-ui'

	const schema = {
		title: 'user settings',
		type: 'object',
		properties: {
			lineHeight: {
				title: 'Line Height',
				type: 'number',
				minimum: 5,
				maximum: 25,
				component: 'range'
			},
			fontFamily: {
				title: 'Font Family',
				type: 'string',
				enum: ['serif', 'sans-serif', 'Jost'],
				component: 'select'
			},
			fontSize: {
				title: 'Font Size',
				type: 'number',
				minimum: 10,
				maximum: 48,
				component: 'range'
			},
			fontWeight: {
				title: 'Font Width',
				type: 'number',
				minimum: 100,
				maximum: 900,
				multipleOf: 100,
				component: 'range'
			},
			contentWidth: {
				title: 'Content Width',
				type: 'number',
				minimum: 1,
				maximum: 100,
				component: 'range'
			}
		}
	}

	const changeHandler = (e, path) => {
		$userSettings = {
			...$userSettings,
			[path[0]]: e
		}
	}

	const eraseDb = async () => {
		let text = 'Delete database?\nThis cannot be undone'
		if (confirm(text) == true) {
			mainService.send({type: 'ERASE_DATABASE'})
		}
	}
</script>

<!--TODO: line-height, font-family, dark mode
Also turn into component-->
<Details title={'Settings'}>
		<Form {schema} data={$userSettings} {changeHandler} />
		<button on:click={() => eraseDb()}>Erase Database</button>
		<a href="/delegate-access">Connect another device</a>
</Details>
