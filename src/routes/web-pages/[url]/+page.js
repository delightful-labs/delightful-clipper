import { mainService } from '$lib/machines/mainMachine'
import jsonata from 'jsonata'

const loadDatabase = new Promise(res => {
  mainService.subscribe(x => {
    if (x.context.db.length) {
      res(x.context.db)
    }
  })
})

/** @type {import('./$types').PageLoad} */
export async function load({ params }) {
  const db = await loadDatabase
  const article = await jsonata(`$$[url = "${params.url}"]`).evaluate(db)
  return article
}