<script>
  
  /** @enum {string} */
  const TextInputTypes = {
    Email: 'email',
    Search: 'search',
    Text: 'text',
    Url: 'url'
  };

  /**
   * @type {string}
   */
   export let name = ''

  /**
   * @type {TextInputTypes}
   */
  export let type = 'text'

  /**
	 * @type {string}
	 */
  export let style = ''

  export let value = ''

  /**
   * @type {string[]|undefined}
   */
  export let list

  /**
   * @type {boolean}
   */
  export let hidden = false

  /**
	 * @type {string}
	 */
   export let placeholder = ''

</script>

<input 
  list={list ? `${name}-list` : undefined} 
  type='text'
  {style} 
  bind:value={value} 
  {name} 
  {hidden}
  id={name}
  {placeholder}
/>

{#if list}
  <datalist id="{name}-list">
    {#each list as listItem}
      <option value={listItem}></option>
    {/each}
  </datalist>
{/if}

<style>
  input {
    box-sizing: border-box;
    padding: var(--input-padding, 0.5rem 1rem);
    color: var(--input-color, inherit);
    min-height: var(--input-min-height, 48px);
    border-style: var(--input-border-style, solid);
    border-width: var(--input-border-width, 1px);
    background-color: var(--input-background-color, transparent);
  }
</style>