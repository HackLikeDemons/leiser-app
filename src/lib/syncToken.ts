const SYNC_TOKEN_LENGTH = 24

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function generateSyncToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(SYNC_TOKEN_LENGTH))
  return bytesToBase64Url(bytes)
}

export async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return hex(new Uint8Array(digest))
}

