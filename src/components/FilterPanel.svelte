<script>
	import { mainService } from '$lib/machines/main'
  import { filteredArticles } from '$lib/stores'
	import { Details } from 'delightful-ui'
  import jsonata from 'jsonata'

  let tags = []
  let authors = []
  let form

  let opened = false

  let filtersApplied = false

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

  const handleSubmit = async (e) => {
    const formData = new FormData(form)
    const arr = []
    formData.forEach((value, key) => arr.push(`'${value}' in ${key}`));
    
		const articles = await jsonata(`$[${arr.join(' and ')}][]`).evaluate($mainService.context.db)
    
    $filteredArticles = articles || []
  }

  const handleChange = () => {
    const formData = new FormData(form)

    filtersApplied = Array.from(formData.keys()).length ? true : false
  }

  const handleReset = () => {
    $filteredArticles = undefined
    filtersApplied = false
  }

</script>

<Details title={'Filter'} bind:opened>
  <form 
    on:submit|preventDefault={(e) => handleSubmit(e)} bind:this={form}
    on:change={() => handleChange()}
  >
    <p>Tags</p>
    {#each tags as tag}
      <div>
        <input type="checkbox" id={tag} name='tags' value={tag}>
        <label for={tag}>{tag}</label>
      </div>
    {/each}
    <p>Authors</p>
    {#each authors as tag}
      <div>
        <input type="checkbox" id={tag||'unknown'} name='author' value={tag}>
        <label for={tag||'unknown'}>{tag||'unknown'}</label>
      </div>
    {/each}
    <input type="reset" value="Reset Filters" on:click={()=> handleReset()}/>
    {#if filtersApplied}
      <input type="submit" value="Show Results" on:click={()=> opened = false}/>
    {:else}
      <button on:click|preventDefault={()=> opened = false}>Close</button>
    {/if}
  </form>
</Details>

<style>
  div {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  input[type="checkbox"] {
    min-height: 20px;
    width: auto;
  }
</style>