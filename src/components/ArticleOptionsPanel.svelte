<script>
  import ParseForm from "./ParseForm.svelte"
  import { Details } from "delightful-ui"
  import { mainService } from '$lib/machines/main'

  export let url = ''

  /**
   * @type {string[]}
   */
  export let tags = []
</script>

<Details title="Options">
  <div>
    <h3>Update Tags</h3>
    <ParseForm 
      {url}
      {tags}
      action={'UPDATE_ARTICLE'}
      messages={{
        idle: 'Update Tags',
        saving: 'Updating',
        createdNew: '',
        updatedExisting: 'Updated!'
      }}
    />
    <hr />
    <h3>Delete Article</h3>
    <button on:click={()=> mainService.send({ type: 'DELETE_ARTICLE', data: { url: article.url } })}>Delete Article</button>
  </div>
</Details>

<style>
  div {
    width: var(--width__app);
    display: grid;
    gap: var(--spacing__sm);
    padding: var(--spacing__sm);
    outline: 1px solid;
  }
</style>