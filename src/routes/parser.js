// export async function post({ params, request }) {
//   const body = await request.json()
//   console.log(body)
//   return {
//     status: 201,
//     body: body
//   }
// }

import { extract } from 'article-parser'

export async function post({ params, request }) {
  const body = await request.json()

  const article = await extract(body.url)
  .catch((err) => {
    return {
      status: 400,
      body: err
    }
  })

  return {
    status: 201,
    body: article
  }
}