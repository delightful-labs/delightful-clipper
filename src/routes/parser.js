import { extract } from 'article-parser'
import { curry, reduce, assoc, keys } from 'ramda'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

const renameKeys = curry((keysMap, obj) =>
  reduce((acc, key) => assoc(keysMap[key] || key, obj[key], acc), {}, keys(obj))
)

export async function post({ params, request }) {
  const body = await request.json()

  let article

  if (body.url.match( /\.pdf$/i) ) {
    const pdf = await fetch(body.url)
    res = await pdfjsLib.getDocument(pdf).promise
      .catch(a => console.log('ERROR: ', a) )
    const meta = await res.getMetadata()
    const renamedMeta = renameKeys({ 
      Author: 'author', 
      Title: 'title',
      CreationDate: 'published',
      Creator: 'source'
    })(meta.info)
    renamedMeta.url = body.url
    renamedMeta.file = pdf
    article = renamedMeta
    //@TODO: normalize times
  } else {
    article = await extract(body.url)
      .catch((err) => {
        console.log(err)
        return {
          status: 400,
          body: err
        }
      })
  }


  return {
    status: 201,
    body: article
  }
}