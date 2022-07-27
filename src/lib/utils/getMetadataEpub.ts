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

const filterKeys = list => Object.fromEntries(
  keys_to_keep.map(k => [k, list[k]])
)

const getMetadataEpub = async (file: File) => {
  const book = epub.default(file)
  const metadata = await book.loaded.metadata
  const newData = renameKeys(blueprint, metadata)
  const simplifiedData = filterKeys(newData)
  return simplifiedData
}

export default getMetadataEpub