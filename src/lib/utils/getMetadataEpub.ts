import * as epub from 'epubjs'

const getMetadataEpub = async (file: File) => {
  const book = epub.default(file)
  const metadata = await book.loaded.metadata
  console.log(metadata)
  return metadata
}

export default getMetadataEpub