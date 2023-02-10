import { sha256 } from 'webnative/components/crypto/implementation/browser'
import * as uint8arrays from 'uint8arrays'

/** 
 * @typedef {import('webnative/components').Components} Components
 * @typedef {import('webnative/components/auth/implementation').Implementation<Components>} AuthStrategy 
 */

/**
 * 
 * @param {string} username 
 * @returns {Promise<string>}
 */
export const prepareUsername = async (username) => {

  /**
   * Create a new DID for the user, which will be appended to their username, concatenated
   * via a `#`, hashed and encoded to ensure uniqueness
   */
  const did = await createDID(crypto)
  const fullUsername = `${username}#${did}`
  //await storage.setItem(USERNAME_STORAGE_KEY, fullUsername)

  const normalizedUsername = fullUsername.normalize('NFD')

  const hashedUsername = await sha256(
    new TextEncoder().encode(normalizedUsername)
  )

  return uint8arrays
    .toString(hashedUsername, 'base32')
    .slice(0, 32)
}

/**
 * 
 * @param {string} username 
 * @param {AuthStrategy} authStrategy
 */
export const register = async (username, authStrategy) => {
  const hashedUsername = await prepareUsername(username)

  const { success } = await authStrategy.register({ username: hashedUsername })

  console.log()
}