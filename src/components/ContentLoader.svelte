<script>
  import { mainService } from "$lib/machines/main"

  export let filePath

  mainService.send({ type: 'LOAD_CONTENT', data: { filePath: filePath }})

  const content = new Promise(res => {
    mainService.subscribe(x => {
      console.log(x.event)
      // if (x.context.db.length) {
      //   //res(x.context.db)
      // }
    })
  })
</script>

{#await content}
  <p>Loading</p>
{:then value} 
  {@html value}
{/await}