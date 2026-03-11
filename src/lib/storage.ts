export function readStorageItem(key: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function readTrimmedStorageItem(key: string): string | null {
  const value = readStorageItem(key)?.trim()
  return value ? value : null
}

export function writeStorageItem(key: string, value: string): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStorageItem(key: string): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
