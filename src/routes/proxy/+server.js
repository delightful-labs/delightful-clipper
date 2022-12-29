/**
 * @param { import('@sveltejs/kit').RequestEvent } request
 */
export async function GET({ url }) {

  const item = url.searchParams.get('url')

  //@TODO: make sure a URL was really passed.
  //Otherwise, return an error.
  const res = await fetch(item).then(x => x.blob())

  return new Response(res)
}
