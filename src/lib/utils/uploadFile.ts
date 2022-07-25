import type FileSystem from 'webnative/fs/filesystem'
import * as wn from 'webnative'

//Takes in a file to upload, returns a CiD
export default async function uploadFile(files: FileList, fs: FileSystem) {

  const file = files[0]

  const path = wn.path.file('public', 'Web Pages', file.name)

  await fs.write(
    path,
    file,
    { publish: true }
  )

  const prettyPath = wn.path.combine(
    wn.path.directory(wn.path.Branch.Pretty),
    wn.path.removeBranch(path)
  )

  const rootCid = await fs.root.put()

  const prettyIpfsPath = `/ipfs/${rootCid}/${wn.path.toPosix(prettyPath)}`

  const ipfs = await wn.ipfs.get()

  const stats = await ipfs.files.stat(prettyIpfsPath)

  return stats.cid.toString()
}