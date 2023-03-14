import { mainService } from '$lib/machines/main'
import jsonata from 'jsonata'

export let prerender = false

/** @type {import('./$types').PageLoad} */
export async function load({ params }) {
  const loadDatabase = new Promise(res => {
    mainService.subscribe(x => {
      if (x.context.db.length) {
        res(x.context.db)
      }
    })
  })

  const db = await loadDatabase
  const article = await jsonata(`$$[url = "${params.url}"]`).evaluate(db)

  return article
}