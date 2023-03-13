<script>
	import { createMachine } from 'xstate'
	import { useMachine } from '@xstate/svelte'
  import { mainService } from '$lib/machines/main'
  import jsonata from 'jsonata'
	import TagInput from './TagInput.svelte'

	//@todo: use a zod schema that would fill in defaults
	export let messages = {
		idle: 'Save Article',
		saving: 'Saving',
		createdNew: 'Saved!',
		updatedExisting: 'Already Exists'
	}

	//@todo: put this in context
	/**
	 * @type {string[]}
	 */
	let tagList = []

  /**
	 * @type {string}
	 */
  export let url = ''

	/**
	 * @type {string[]}
	 */
	export let tags = []

	/**
	 * @type {'SAVE_ARTICLE'|'UPDATE_ARTICLE'}
	 */
	export let action = 'SAVE_ARTICLE'

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
						actions: () => mainService.send({type: action, data: { url: url, tags: tags }})
					}
				},
				meta: {
					message: messages.idle
				}
			},
			saving: {
				on: {
					ARTICLE_SAVED: {
						target: 'saved',
						actions: ()=> clearData()
					},
					//@todo: separate the actions so that instead of
					//ARTICLE_ALREADY_EXISTS it is something like NO_ACTION_TAKEN
					ARTICLE_ALREADY_EXISTS: {
						target: 'alreadyExists',
						actions: ()=> clearData()
					},
					ARTICLE_UPDATED: {
						target: 'alreadyExists',
						actions: ()=> clearData()
					}
				},
				meta: {
					message: messages.saving
				}
			},
			saved: {
				after: {
					2000: {
						target: 'idle'
					}
				},
				meta: {
					message: messages.createdNew
				}
			},
			alreadyExists: {
				after: {
					2000: {
						target: 'idle'
					}
				},
				meta: {
					message: messages.updatedExisting
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
		console.log('finding tags')
    findTags($mainService.context.db)
  }

	$: if ($mainService.event.type === 'ARTICLE_SAVED') {
		send({ type: 'ARTICLE_SAVED'})
  }

	$: if ($mainService.event.type === 'ARTICLE_UPDATED') {
		send({ type: 'ARTICLE_UPDATED'})
  }

	$: if ($mainService.event.type === 'ARTICLE_ALREADY_EXISTS') {
		send({ type: 'ARTICLE_ALREADY_EXISTS'})
  }

	$: console.log(tags)

</script>

<form on:submit|preventDefault={() => handleSubmit()}>
		<div hidden={action !== 'SAVE_ARTICLE'}>
			<label for="url">URL</label>
			<input name="url" id="url" type="url" bind:value={url} required />
		</div>

		<div>
			<TagInput {tagList} bind:tags={tags}/>
		</div>

		<!-- @todo: if action is UPDATE_ARTICLE, 
			disable if content has not actually been changed from initiial state -->
		<input type="submit" value={Object.values($state.meta)[0]?.message} disabled={!$state.matches('idle')} />
</form>




