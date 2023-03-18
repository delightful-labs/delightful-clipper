<script>
  import Text from '$components/Text.svelte'
	import { ScreenReaderText } from 'delightful-ui'

  /**
	 * @type {string[]}
	 */
	export let tagList = []

  /**
	 * @type {string[]}
	 */
	export let tags = []

  const handleSubmit = (e) => {
    const formData = new FormData(e.target)
    // @todo: add notification if is the same as existing tags
    formData.forEach((value) => tags = [...new Set(tags.concat(value))])
    e.target.reset()
  }

  /**
   * @param {string} text
   */
  const handleDelete = (text) => {
    tags = tags.filter(x => x !== text)
  }

</script>

{#if tags}
  <div>
    <Text name='tags' value={tags.join(', ')} hidden={true}/>
    <div class="tag-list">
      {#each tags as tag}
        <div class='tag'>
          <span class="tag-text">
            {tag}
          </span>
          <button on:click|preventDefault={()=> handleDelete(tag)}>
            <ScreenReaderText>Delete</ScreenReaderText>
            <span>X</span>
          </button>
        </div>
      {/each}
      <form on:submit|preventDefault={(e)=> handleSubmit(e)}>
        <ScreenReaderText>
          <label for='tag'>Tags</label>
        </ScreenReaderText>
        <Text name='tag' list={tagList} style='width: auto;' placeholder="Add tag" />
        <ScreenReaderText>
          <input type="submit" value="Add Tags" />
        </ScreenReaderText>
      </form>
    </div>
  </div>
{/if}


<style>
  .tag {
    background-color: var(--color__actionable);
    color: black;
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 0 auto;
    font-family: var(--font-family__secondary);
  }

  .tag-text {
    padding: 0.5rem 0 0.5rem 1rem;
  }

  .tag button {
    border: 0;
    min-width: 40px;
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing__sm);
  }

  form {
    flex: 1;
  }
</style>