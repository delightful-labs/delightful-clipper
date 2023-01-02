import { error } from '@sveltejs/kit'

/**
 * A proxy to fetch content from the web
 * @param { import('@sveltejs/kit').RequestEvent } request
 */
export async function GET({ url }) {

  const item = url.searchParams.get('url')

  const res = await fetch(item||'').then(response => {
    if (!response.ok) {
      throw error(response.status, {
        message: response.statusText
      })
    }

    return response.blob()
  }).catch(err => {
    throw error(500, {
      message: err.message,
    })
  })

  return new Response(res)
}
