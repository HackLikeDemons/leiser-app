const SYNC_KEY_STORAGE_KEY = 'leiser-sync-key'
const E2EE_SALT_STORAGE_KEY = 'leiser:e2ee:salt'
const E2EE_WRAPPED_CONTENT_KEY_STORAGE_KEY = 'leiser:e2ee:wrapped-content-key'
const E2EE_MIGRATION_DONE_KEY = 'leiser:e2ee:migrated-v1'

const PBKDF2_ITERATIONS = 250000
const CONTENT_KEY_LENGTH = 32
const AES_GCM_IV_BYTES = 12
const ENCRYPTED_TEXT_PREFIX = 'enc:v1:'

type WrappedContentKeyPackage = {
  v: 1
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ct: string
}

let cachedContentKeyPromise: Promise<CryptoKey> | null = null

function hasWindow() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function generateRandomSecret(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function getOrCreateSyncPassphrase() {
  if (!hasWindow()) {
    throw new Error('No browser storage available for E2EE passphrase')
  }
  const existing = localStorage.getItem(SYNC_KEY_STORAGE_KEY)?.trim()
  if (existing) {
    return existing
  }
  const generated = generateRandomSecret(32)
  localStorage.setItem(SYNC_KEY_STORAGE_KEY, generated)
  return generated
}

function getOrCreateSalt() {
  if (!hasWindow()) {
    throw new Error('No browser storage available for E2EE salt')
  }
  const existing = localStorage.getItem(E2EE_SALT_STORAGE_KEY)
  if (existing) {
    return existing
  }
  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)))
  localStorage.setItem(E2EE_SALT_STORAGE_KEY, salt)
  return salt
}

async function deriveWrappingKey(passphrase: string, saltBase64: string) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(base64ToBytes(saltBase64)),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function importRawAesKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function createAndStoreWrappedContentKey(passphrase: string) {
  if (!hasWindow()) {
    throw new Error('No browser storage available for E2EE key material')
  }
  const salt = getOrCreateSalt()
  const wrappingKey = await deriveWrappingKey(passphrase, salt)
  const raw = crypto.getRandomValues(new Uint8Array(CONTENT_KEY_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    wrappingKey,
    toArrayBuffer(raw),
  )

  const payload: WrappedContentKeyPackage = {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(wrapped)),
  }
  localStorage.setItem(E2EE_WRAPPED_CONTENT_KEY_STORAGE_KEY, JSON.stringify(payload))

  return importRawAesKey(raw)
}

async function unwrapStoredContentKey(passphrase: string, serializedPayload: string) {
  const parsed = JSON.parse(serializedPayload) as Partial<WrappedContentKeyPackage>
  if (
    parsed.v !== 1 ||
    parsed.kdf !== 'PBKDF2-SHA256' ||
    parsed.iterations !== PBKDF2_ITERATIONS ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.iv !== 'string' ||
    typeof parsed.ct !== 'string'
  ) {
    throw new Error('Invalid wrapped content key package')
  }

  const wrappingKey = await deriveWrappingKey(passphrase, parsed.salt)
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(parsed.iv)) },
    wrappingKey,
    toArrayBuffer(base64ToBytes(parsed.ct)),
  )

  if (hasWindow()) {
    localStorage.setItem(E2EE_SALT_STORAGE_KEY, parsed.salt)
  }

  return importRawAesKey(new Uint8Array(raw))
}

async function getContentKey(): Promise<CryptoKey> {
  if (cachedContentKeyPromise) {
    return cachedContentKeyPromise
  }

  cachedContentKeyPromise = (async () => {
    const passphrase = getOrCreateSyncPassphrase()
    const serialized = hasWindow() ? localStorage.getItem(E2EE_WRAPPED_CONTENT_KEY_STORAGE_KEY) : null
    if (!serialized) {
      return createAndStoreWrappedContentKey(passphrase)
    }
    return unwrapStoredContentKey(passphrase, serialized)
  })()

  return cachedContentKeyPromise
}

export function isEncryptedNoteText(value: string) {
  return value.startsWith(ENCRYPTED_TEXT_PREFIX)
}

export async function encryptNoteTextForStorage(plainText: string): Promise<string> {
  if (isEncryptedNoteText(plainText)) {
    return plainText
  }
  const contentKey = await getContentKey()
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
  const clearBytes = new TextEncoder().encode(plainText)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    contentKey,
    toArrayBuffer(clearBytes),
  )
  return `${ENCRYPTED_TEXT_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`
}

export async function decryptNoteTextForRuntime(value: string): Promise<string> {
  if (!isEncryptedNoteText(value)) {
    return value
  }

  const payload = value.slice(ENCRYPTED_TEXT_PREFIX.length)
  const [ivPart, ctPart] = payload.split(':')
  if (!ivPart || !ctPart) {
    throw new Error('Invalid encrypted note payload')
  }

  const contentKey = await getContentKey()
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(ivPart)) },
    contentKey,
    toArrayBuffer(base64ToBytes(ctPart)),
  )
  return new TextDecoder().decode(new Uint8Array(plain))
}

export async function ensureLocalEncryptionReady(): Promise<void> {
  await getContentKey()
}

export function resetE2eeCache() {
  cachedContentKeyPromise = null
}

export function clearE2eeLocalMaterial() {
  if (!hasWindow()) {
    return
  }
  localStorage.removeItem(E2EE_SALT_STORAGE_KEY)
  localStorage.removeItem(E2EE_WRAPPED_CONTENT_KEY_STORAGE_KEY)
  localStorage.removeItem(E2EE_MIGRATION_DONE_KEY)
  resetE2eeCache()
}

export function isE2eeMigrationDone() {
  if (!hasWindow()) {
    return false
  }
  return localStorage.getItem(E2EE_MIGRATION_DONE_KEY) === '1'
}

export function markE2eeMigrationDone() {
  if (!hasWindow()) {
    return
  }
  localStorage.setItem(E2EE_MIGRATION_DONE_KEY, '1')
}

export function getWrappedContentKeyForPairing(): string | null {
  if (!hasWindow()) {
    return null
  }
  return localStorage.getItem(E2EE_WRAPPED_CONTENT_KEY_STORAGE_KEY)
}

export function setWrappedContentKeyFromPairing(serializedPayload: string) {
  if (!hasWindow()) {
    return
  }
  const parsed = JSON.parse(serializedPayload) as Partial<WrappedContentKeyPackage>
  if (
    parsed.v !== 1 ||
    parsed.kdf !== 'PBKDF2-SHA256' ||
    parsed.iterations !== PBKDF2_ITERATIONS ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.iv !== 'string' ||
    typeof parsed.ct !== 'string'
  ) {
    throw new Error('Invalid wrapped content key package')
  }

  localStorage.setItem(E2EE_SALT_STORAGE_KEY, parsed.salt)
  localStorage.setItem(E2EE_WRAPPED_CONTENT_KEY_STORAGE_KEY, serializedPayload)
  resetE2eeCache()
}
