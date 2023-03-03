import { mainService } from '$lib/machines/main'
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
  const articles = await jsonata(`$$['${params.tag}' in tags][]`).evaluate(db)
  return {
    tag: params.tag,
    articles: articles
  }
}