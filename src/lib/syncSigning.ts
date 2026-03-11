import { getOrCreateDeviceId } from './device'
import { readStorageItem, writeStorageItem } from './storage'
import type { ChangeEnvelope } from './types'

const PRIVATE_KEY_STORAGE_KEY = 'leiser:syncSigning:privatePkcs8'
const PUBLIC_KEY_STORAGE_KEY = 'leiser:syncSigning:publicRaw'
const TRUSTED_KEYS_STORAGE_KEY = 'leiser:syncSigning:trustedKeys'

type TrustedKeysMap = Record<string, string>

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function canUseWebCryptoSignatures() {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
}

function stableStringify(value: Record<string, unknown>) {
  const keys = Object.keys(value).sort()
  const ordered: Record<string, unknown> = {}
  for (const key of keys) {
    ordered[key] = value[key]
  }
  return JSON.stringify(ordered)
}

function getEnvelopeSigningPayload(envelope: ChangeEnvelope) {
  return stableStringify({
    changeId: envelope.changeId,
    roomId: envelope.roomId,
    deviceId: envelope.deviceId,
    noteId: envelope.noteId,
    ts: envelope.ts,
    kind: envelope.kind,
    payload: envelope.payload,
    signerDeviceId: envelope.signerDeviceId ?? envelope.deviceId,
    signerPublicKey: envelope.signerPublicKey ?? '',
  })
}

function loadTrustedKeysMap(): TrustedKeysMap {
  const raw = readStorageItem(TRUSTED_KEYS_STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as TrustedKeysMap
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    return parsed
  } catch {
    return {}
  }
}

function saveTrustedKeysMap(map: TrustedKeysMap) {
  writeStorageItem(TRUSTED_KEYS_STORAGE_KEY, JSON.stringify(map))
}

function setTrustedPublicKey(deviceId: string, publicKeyBase64: string) {
  const current = loadTrustedKeysMap()
  if (current[deviceId] === publicKeyBase64) {
    return
  }
  current[deviceId] = publicKeyBase64
  saveTrustedKeysMap(current)
}

async function importPrivateKey(pkcs8Base64: string) {
  const bytes = base64ToBytes(pkcs8Base64)
  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(bytes),
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
}

async function importPublicKey(rawBase64: string) {
  const bytes = base64ToBytes(rawBase64)
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(bytes),
    { name: 'Ed25519' },
    false,
    ['verify'],
  )
}

export async function getOrCreateSigningIdentity(): Promise<{
  deviceId: string
  publicKeyBase64: string
} | null> {
  if (!canUseWebCryptoSignatures()) {
    return null
  }

  const deviceId = getOrCreateDeviceId()
  const storedPrivate = readStorageItem(PRIVATE_KEY_STORAGE_KEY)
  const storedPublic = readStorageItem(PUBLIC_KEY_STORAGE_KEY)
  if (storedPrivate && storedPublic) {
    setTrustedPublicKey(deviceId, storedPublic)
    return { deviceId, publicKeyBase64: storedPublic }
  }

  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const privatePkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const privateBase64 = bytesToBase64(privatePkcs8)
  const publicBase64 = bytesToBase64(publicRaw)

  writeStorageItem(PRIVATE_KEY_STORAGE_KEY, privateBase64)
  writeStorageItem(PUBLIC_KEY_STORAGE_KEY, publicBase64)
  setTrustedPublicKey(deviceId, publicBase64)
  return { deviceId, publicKeyBase64: publicBase64 }
}

export async function signEnvelope(envelope: ChangeEnvelope): Promise<ChangeEnvelope> {
  const identity = await getOrCreateSigningIdentity()
  if (!identity || !canUseWebCryptoSignatures()) {
    return envelope
  }

  const privateBase64 = readStorageItem(PRIVATE_KEY_STORAGE_KEY)
  if (!privateBase64) {
    return envelope
  }

  const signerDeviceId = identity.deviceId
  const signerPublicKey = identity.publicKeyBase64
  const envelopeForSigning: ChangeEnvelope = {
    ...envelope,
    signerDeviceId,
    signerPublicKey,
  }
  const payload = getEnvelopeSigningPayload(envelopeForSigning)
  const privateKey = await importPrivateKey(privateBase64)
  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(payload)),
  )

  return {
    ...envelopeForSigning,
    signature: bytesToBase64(signatureBytes),
  }
}

export async function verifyTrustedEnvelope(envelope: ChangeEnvelope): Promise<boolean> {
  if (!canUseWebCryptoSignatures()) {
    return false
  }

  const signerDeviceId = envelope.signerDeviceId
  const signerPublicKey = envelope.signerPublicKey
  const signature = envelope.signature
  if (!signerDeviceId || !signerPublicKey || !signature) {
    return false
  }

  const trusted = loadTrustedKeysMap()
  const knownKey = trusted[signerDeviceId]
  if (!knownKey) {
    setTrustedPublicKey(signerDeviceId, signerPublicKey)
  } else if (knownKey !== signerPublicKey) {
    return false
  }

  const payload = getEnvelopeSigningPayload(envelope)
  const publicKey = await importPublicKey(signerPublicKey)
  const signatureBytes = base64ToBytes(signature)
  return crypto.subtle.verify(
    'Ed25519',
    publicKey,
    toArrayBuffer(signatureBytes),
    new TextEncoder().encode(payload),
  )
}

export function isSyncSigningSupported() {
  return canUseWebCryptoSignatures()
}
