<script>
  import { mainService } from "$lib/machines/main"
  import { LoadingSpinner } from 'delightful-ui'

  export let filePath

  const content = new Promise(res => {
    mainService.subscribe(x => {
      if (x.event.type === 'CONTENT_LOADED') {
        if (JSON.stringify(x.event.data.filePath) === JSON.stringify(filePath)) {
          res(x.event.data.content)
        }
      }
    })
  })

  mainService.send({ type: 'LOAD_CONTENT', data: { filePath: filePath }})
</script>

{#await content}
  <LoadingSpinner />
{:then value} 
  {@html value}
{/await}