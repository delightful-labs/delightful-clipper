export async function post({ params, request }) {
  const body = await request.json()

  const image = await fetch(body.url)

  const blob = image.body

  return {
    status: 201,
    body: {blob: blob}
  }
}