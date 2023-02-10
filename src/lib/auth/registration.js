import { sha256 } from 'webnative/components/crypto/implementation/browser'
import { publicKeyToDid } from 'webnative/did/transformers'
import * as uint8arrays from 'uint8arrays'

/** 
 * @typedef {import('webnative').Program} Program
 * @typedef {import('webnative/components').Components} Components
 * @typedef {import('webnative/components/auth/implementation').Implementation<Components>} AuthImplementation
 * @typedef {import('webnative/components/crypto/implementation').Implementation} CryptoImplementation
 */

/**
 * 
 * @param {CryptoImplementation} crypto 
 * @returns {Promise<string>}
 */
export const createDID = async (crypto) => {
  const pubKey = await crypto.keystore.publicExchangeKey()
  console.log(pubKey)
  const ksAlg = await crypto.keystore.getAlgorithm()

  return publicKeyToDid(crypto, pubKey, ksAlg)
}

/**
 * 
 * @param {string} username 
 * @param {CryptoImplementation} crypto
 * @returns {Promise<string>}
 */
export const prepareUsername = async (username, crypto) => {

  /**
   * Create a new DID for the user, which will be appended to their username, concatenated
   * via a `#`, hashed and encoded to ensure uniqueness
   */
  const did = createDID(crypto)
  console.log(did)
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
 * @param {Components} programComponents
 */
export const register = async (username, programComponents) => {
  console.log(programComponents)
  const hashedUsername = await prepareUsername(username, programComponents.crypto)

  //const { success } = await programComponents.auth.register({ username: hashedUsername })

  console.log(hashedUsername)
}
