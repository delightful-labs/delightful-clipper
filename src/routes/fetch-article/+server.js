import ogs from 'open-graph-scraper'

/** @typedef { import('@sveltejs/kit').RequestEvent } Request */

/**
 * @param { Request } request
 */
export async function POST({ request }) {
  const req = await request.json()
  const res = await  ogs({ url: req.url, downloadLimit: 2000000 })

  return res
}
