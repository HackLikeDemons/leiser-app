import { readStorageItem, writeStorageItem } from './storage'

const DEVICE_ID_KEY = 'leiser:deviceId'

export function getOrCreateDeviceId(): string {
  const existing = readStorageItem(DEVICE_ID_KEY)
  if (existing) {
    return existing
  }

  const created = crypto.randomUUID()
  writeStorageItem(DEVICE_ID_KEY, created)
  return created
}
