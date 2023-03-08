<script>
	import { mainService } from '$lib/machines/main'
	import { Details } from 'delightful-ui'
  import jsonata from 'jsonata'

  let tags = []
  let authors = []

  /**
   * @typedef {import('$lib/schemas/Article').Article} Article
   * @param {Article[]} db
   */
  const findTags = async (db) => {
    tags = await jsonata(`$distinct([tags])`).evaluate(db)
  }

  /**
   * @typedef {import('$lib/schemas/Article').Article} Article
   * @param {Article[]} db
   */
  const findAuthors = async (db) => {
    authors = await jsonata(`$distinct([author])`).evaluate(db)
  }

  //@todo: can probably use useSelector to clean this up
  $: if ($mainService.context) {
    findTags($mainService.context.db)
    findAuthors($mainService.context.db)
  }

  const handleSubmit = () => {
		
  }
</script>

<Details title={'Filter'}>
  <form on:submit|preventDefault={() => handleSubmit()}>
    <p>Tags</p>
    {#each tags as tag}
      <div>
        <input type="checkbox" id={tag} name={tag}>
        <label for={tag}>{tag}</label>
      </div>
    {/each}
    <p>Authors</p>
    {#each authors as tag}
      <div>
        <input type="checkbox" id={tag||'unknown'} name={tag||'unknown'}>
        <label for={tag||'unknown'}>{tag||'unknown'}</label>
      </div>
    {/each}
  </form>
</Details>