import { sha256 } from 'webnative/components/crypto/implementation/browser'
import { publicKeyToDid } from 'webnative/did/transformers'
import * as uint8arrays from 'uint8arrays'

/** 
 * @typedef {import('webnative').Program} Program
 * @typedef {import('webnative/components').Components} Components
 * @typedef {import('webnative/components/auth/implementation').Implementation<Components>} AuthImplementation
 * @typedef {import('webnative/components/crypto/implementation').Implementation} CryptoImplementation
 * @typedef {import('webnative/components/storage/implementation').Implementation} StorageImplementation
 */

export const USERNAME_STORAGE_KEY = 'fullUsername'

/**
 * 
 * @param {CryptoImplementation} crypto 
 * @returns {Promise<string>}
 */
export const createDID = async (crypto) => {

  const pubKey = await crypto.keystore.publicExchangeKey()

  const ksAlg = await crypto.keystore.getAlgorithm()

  return publicKeyToDid(crypto, pubKey, ksAlg)
}

/**
 * Create a new DID for the user, which will be appended to their username, concatenated
 * via a `#`, hashed and encoded to ensure uniqueness
 * @param {string} username 
 * @param {CryptoImplementation} crypto
 * @returns {Promise<string>}
 */
export const createFullUsername = async (username, crypto) => {

  const did = await createDID(crypto)

  const fullUsername = `${username}#${did}`

  return fullUsername
}

/**
 * 
 * @param {string} fullUsername 
 * @returns {Promise<string>}
 */
export const hashFullUsername = async (fullUsername) => {  

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
 * @param {string} fullUsername 
 * @param {StorageImplementation} storageImplementation
 */
export const setFullUserName = async (fullUsername, storageImplementation) => {
  await storageImplementation.setItem(USERNAME_STORAGE_KEY, fullUsername)
}

/**
 * 
 * @param {string} fullUsername 
 * @param {AuthImplementation} authImplementation
 */
export const register = async (fullUsername, authImplementation) => {

  const hashedFullUsername = await hashFullUsername(fullUsername)

  const { success } = await authImplementation.register({ username: hashedFullUsername })

  console.log(success)

  return success
}
