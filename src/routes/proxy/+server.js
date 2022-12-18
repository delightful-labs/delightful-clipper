import ogs from 'open-graph-scraper'
//const res = await  ogs({ url: req.url, downloadLimit: 2000000 })

/**
 * @param { import('@sveltejs/kit').RequestEvent } request
 */
export async function GET({ url }) {

  const item = url.searchParams.get('url')

  const res = await fetch(item).then(x => x.blob())

  return new Response(res)
}
