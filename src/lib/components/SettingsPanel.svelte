<script>
  import { userSettings, state, send } from '$lib/stores'
  import Form from 'svelte-json-schema-to-form/Form.svelte'
  import DetailsSummary from '$lib/components/DetailsSummary.svelte'

  const { contentWidth, fontSize } = userSettings

  //await $state.fs.write(dbFilePath, {}, { publish: true })
  const eraseDb = async () => {
    let text = 'Delete database?\nThis cannot be undone'
    if (confirm(text) == true) {
      send('ERASE_DATABASE')
    }
  }

  const schema = {
    title: 'user settings',
    type: 'object',
    properties: {
      fontSize: {
        title: 'Font Size',
        type: 'number',
        minimum: 10,
        maximum: 48,
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
      [path[0]]: e,
    }
  }
</script>

<!--TODO: line-height, font-family, margins/max-width, dark mode
Also turn into component-->
<DetailsSummary title={'Settings'}>
  <Form {schema} data={$userSettings} {changeHandler} />
  <button on:click={eraseDb}>Erase Database</button>
  <p>Status: {JSON.stringify($state?.value)}</p>
</DetailsSummary>

<style>
  .setting-container {
    display: flex;
    align-items: center;
  }
</style>
