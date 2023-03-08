<script>
	import { createMachine, actions, assign } from 'xstate'
	import { useMachine } from '@xstate/svelte'
	import InputTags from '$components/InputTags.svelte'
  import { mainService } from '$lib/machines/main'
  import jsonata from 'jsonata'

	//@todo: put this in context
	/**
	 * @type {string[]}
	 */
	let tagList = []

  /**
	 * @type {string}
	 */
  let url = ''

	/**
	 * @type {string[]}
	 */
	let tags = []

  const handleSubmit = () => {
		send({type: 'SAVE_ARTICLE'})
  }

	const clearData = () => {
		url = ''
		tags = []
	}

	const saveArticleMachine =  createMachine({
		initial: 'idle',
		id: 'save',
		states: {
			idle: {
				on: {
					SAVE_ARTICLE: {
						target: 'saving',
						actions: () => mainService.send({type: 'SAVE_ARTICLE', data: { url: url, tags: tags }})
					}
				},
				meta: {
					message: 'Save Article'
				}
			},
			saving: {
				on: {
					ARTICLE_SAVED: {
						target: 'saved',
						actions: ()=> clearData()
					},
					ARTICLE_ALREADY_EXISTS: {
						target: 'alreadyExists',
						actions: ()=> clearData()
					}
				},
				meta: {
					message: 'Saving'
				}
			},
			saved: {
				after: {
					2000: {
						target: 'idle'
					}
				},
				meta: {
					message: 'Saved!'
				}
			},
			alreadyExists: {
				after: {
					2000: {
						target: 'idle'
					}
				},
				meta: {
					message: 'Already Exists'
				}
			}
		}
	})

	const { state, send } = useMachine(saveArticleMachine)

  /**
   * @typedef {import('$lib/schemas/Article').Article} Article
   * @param {Article[]} db
   */
  const findTags = async (db) => {
    tagList = await jsonata(`$distinct([tags])`).evaluate(db)
  }

  $: if ($mainService.context) {
    findTags($mainService.context.db)
  }

	$: if ($mainService.event.type === 'ARTICLE_SAVED') {
		send({ type: 'ARTICLE_SAVED'})
  }

	$: if ($mainService.event.type === 'ARTICLE_ALREADY_EXISTS') {
		send({ type: 'ARTICLE_ALREADY_EXISTS'})
  }

</script>

<form on:submit|preventDefault={() => handleSubmit()}>
		<div>
			<label for="url">URL</label>
			<input name="url" id="url" type="url" bind:value={url} required />
		</div>

		<div>
			<InputTags {tagList} {tags}/>
		</div>

		<input type="submit" value={Object.values($state.meta)[0]?.message} disabled={!$state.matches('idle')} />
</form>
