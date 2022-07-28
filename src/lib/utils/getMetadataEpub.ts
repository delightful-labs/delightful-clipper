import * as epub from 'epubjs'

const renameKeys = (keysMap: object, obj: object) => Object.keys(obj).reduce(
  (acc, key) => ({
    ...acc,
    ...{ [keysMap[key] || key]: obj[key] },
  }),
  {}
)

const blueprint = {
  "title": "title",
  "creator": "author",
  "description": "description",
  "pubdate": "published",
  //"publisher": "Cascade Books",
  //"identifier": "urn:uuid:6458D5E5-F165-4A02-8459-4B96A247E471",
}

const keys_to_keep = Object.values(blueprint)

const filterKeys = (obj: object, keys_to_keep: string[]): object => Object.fromEntries(
  keys_to_keep.map(k => [k, obj[k]])
)

const getMetadataEpub = async (file: ArrayBuffer, cid: string) => {
  console.log(file)
  const book = epub.default(file)
  const metadata = await book.loaded.metadata

  const newData = renameKeys(blueprint, metadata)
  const simplifiedData = filterKeys(newData, keys_to_keep)

  //@TODO: Do this in an immutable way
  if (simplifiedData.published) {
    const date = new Date(simplifiedData.published)
    const formattedDate = date.toISOString()
    simplifiedData.published = formattedDate
  }

  //@TODO: Do this in an immutable way
  simplifiedData.type = 'epub'
  simplifiedData.tags = []
  simplifiedData.file = file.name

  return {
    response: simplifiedData,
    id: cid,
    tags: []
  }
}

export default getMetadataEpub