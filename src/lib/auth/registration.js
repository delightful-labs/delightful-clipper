import { sha256 } from '@oddjs/odd/components/crypto/implementation/browser'
import { publicKeyToDid } from '@oddjs/odd/did/transformers'
import * as uint8arrays from 'uint8arrays'

/** 
 * @typedef {import('@oddjs/odd').Program} Program
 * @typedef {import('@oddjs/odd/components').Components} Components
 * @typedef {import('@oddjs/odd/components/auth/implementation').Implementation<Components>} AuthImplementation
 * @typedef {import('@oddjs/odd/components/crypto/implementation').Implementation} CryptoImplementation
 * @typedef {import('@oddjs/odd/components/storage/implementation').Implementation} StorageImplementation
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
 * @todo: pass in only one componentent, since both share a parent
 * @param {AuthImplementation} authImplementation
 * @param {StorageImplementation} storageImplementation
 */
export const register = async (authImplementation, storageImplementation) => {

  const fullUsername = await storageImplementation.getItem(USERNAME_STORAGE_KEY)
  
  const hashedFullUsername = await hashFullUsername(fullUsername)

  const { success } = await authImplementation.register({ username: hashedFullUsername })

  return success
}
