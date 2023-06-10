import { toString } from 'uint8arrays'

/**
 * @typedef { import('@oddjs/odd/path/index').Partition } Partition
 * @typedef { import('@oddjs/odd/fs/index').default } fs
 * @typedef { import('@oddjs/odd/path/index').Distinctive<[Partition, ...string[]]> } FilePath
 */

/**
 * 
 * @param {BlobPart} file
 * @returns {Promise<Uint8Array>}
 */
export const fileToUint8Array = async (file) => {
  return new Uint8Array(
    await new Blob([ file ]).arrayBuffer()
  )
}

/**
 * Converts a Uint8Array to a string
 * @param {*} unit8 
 * @returns {string}
 */
export const uint8ArrayToString = (unit8) => {
  return toString(unit8)
}

/**
 * 
 * @param {*} path
 * @param {BlobPart} file 
 * @param {fs} fs
 */
export const writeToFileSystem = async (path, file, fs) => {
  const unit8 = await fileToUint8Array(file)

  await fs.write(path, unit8, { publish: true })
}