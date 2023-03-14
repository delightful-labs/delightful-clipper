<script>
	import { userSettings } from '$lib/stores'
	import Form from 'svelte-json-schema-to-form/package/Form.svelte'
	import { Details } from 'delightful-ui'
	import { beforeNavigate } from '$app/navigation'
	import { Font } from 'lib-font'

	const myFont = new Font(`Jost`)

	//console.log(myFont)

	myFont.src = "../Jost-Italic-VariableFont_wght.ttf"

	let fontSupportsWght = false

	myFont.onload = evt => {
		//console.log(evt.de)
		var fontAxes = evt.detail.font.opentype.tables.fvar.getSupportedAxes()
		
		fontSupportsWght = fontAxes.includes('wght')
	}

	const fonts = {
		'serif': {},
		'sans-serif': {},
		'Jost': {
			file: '../Jost-Italic-VariableFont_wght.ttf',
			name: 'Jost',
			type: 'truetype'
		},
		'Beseley': {
			file: '../Besley-Italic-VariableFont_wght.ttf',
			name: 'Besley',
			type: 'truetype'
		}
	}

	let font = fonts[$userSettings.fontFamily]

	$: font = fonts[$userSettings.fontFamily]

	$: if (font.file) {
		const seclectFont = new FontFace(font.name, `url('${font.file}')`)

		seclectFont.load().then(function(loaded_face) {
			document.fonts.add(loaded_face)
		}).catch(e => console.error(e))
	}

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
				enum: Object.keys(fonts),
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

	let opened = false

	beforeNavigate(()=> opened = false)

	const changeHandler = (e, path) => {
		$userSettings = {
			...$userSettings,
			[path[0]]: e
		}
	}
</script>

<Details title={'Display'} bind:opened={opened} >
		<Form {schema} data={$userSettings} {changeHandler} />
</Details>
