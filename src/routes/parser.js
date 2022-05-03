import { extract } from 'article-parser'
import { curry, reduce, assoc, keys, isEmpty } from 'ramda'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

const normalizeDateStrings = (dateString) => {
  if (isEmpty(dateString)) return
  const date = new Date(dateString)
  return date.toISOString()
}

const formatPdfDate = (dateString) => {
  if (isEmpty(dateString)) return
  const trimBeginingD = dateString.replace('D:', '')
  const formattedDate = trimBeginingD.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6')
  return normalizeDateStrings(formattedDate)
}

const renameKeys = curry((keysMap, obj) =>
  reduce((acc, key) => assoc(keysMap[key] || key, obj[key], acc), {}, keys(obj))
)

export async function post({ params, request }) {
  const body = await request.json()

  let article

  if (body.url.match( /\.pdf$/i) ) {
    //@TODO use PromiseAll so both res and buffer can run at same time
    const pdf = await fetch(body.url)
    const buffer = await pdf.arrayBuffer()
    const pdfUint8 = new Uint8Array(buffer)
    const res = await pdfjsLib.getDocument(pdf).promise
      .catch(a => console.log('ERROR: ', a) )
    const meta = await res.getMetadata()
    const renamedMeta = renameKeys({ 
      Author: 'author', 
      Title: 'title',
      CreationDate: 'published',
      Creator: 'source'
    })(meta.info)
    //@TODO: turn into a function that returns the updated object.
    renamedMeta.url = body.url
    renamedMeta.content = pdfUint8
    renamedMeta.meta = meta.metadata
    renamedMeta.type = 'pdf'
    renamedMeta.published = formatPdfDate(meta.info.CreationDate)

    article = renamedMeta
  } else {
    const res = await extract(body.url)
      .catch((err) => {
        console.log(err)
        return {
          status: 400,
          body: err
        }
      })

    res.type = 'html'
    const date = res.published
    res.published = normalizeDateStrings(date)

    article = res
  }


  return {
    status: 201,
    body: article
  }
}