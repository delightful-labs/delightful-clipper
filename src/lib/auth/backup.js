import * as odd from '@oddjs/odd'
/**
 * @typedef { import('@oddjs/odd/fs/index').default } FileSystem
 * @typedef { { created: boolean } | null } BackupStatus
 */

/**
 * Saves a JSON file to WNFS that contains the backup status
 * @param { FileSystem } fs
 * @param { BackupStatus } status
 */
export const setBackupStatus = async (fs, status) => {
  const backupStatusPath = odd.path.file("private", "backup-status.json")
  await fs.write(backupStatusPath, JSON.stringify(status))
  await fs.publish()
}

/**
 * Loads `backup-status.json` from WNFS and returns an object with the `created` boolean  
 * @param { FileSystem } fs
 */
export const getBackupStatus = async fs => {
  const backupStatusPath = odd.path.file("private", "backup-status.json")

  if (await fs.exists(backupStatusPath)) {
    const fileContent = await fs.read(backupStatusPath)

    if (typeof fileContent === "string") {
      return JSON.parse(fileContent)
    }

    console.warn("Unable to load backup status")

    return { created: false }
  } else {
    return { created: false }
  }
}