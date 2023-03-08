<script>
	import { mainService } from '$lib/machines/main'
	import { Details } from 'delightful-ui'
  import jsonata from 'jsonata'

  let tags = []

  /**
   * @typedef {import('$lib/schemas/Article').Article} Article
   * @param {Article[]} db
   */
   const findTags = async (db) => {
    tags = await jsonata(`$distinct([tags])`).evaluate(db)
  }

  $: if ($mainService.context) {
    findTags($mainService.context.db)
  }
</script>

<Details title={'Filter'}>
  {#each tags as tag}
    <div>
      <input type="checkbox" id={tag} name={tag}>
      <label for={tag}>{tag}</label>
    </div>
  {/each}
</Details>