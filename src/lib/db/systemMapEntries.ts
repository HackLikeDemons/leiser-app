import type { SystemMapEntry } from '../systemMapEntry'
import { SYSTEM_INDEX_NAME, SYSTEM_STORE_NAME, openDb } from './db'

type SystemMapUpsertInput = Omit<SystemMapEntry, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<SystemMapEntry, 'id' | 'createdAt' | 'updatedAt'>>

function runTransaction<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => void,
  getResult: () => T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(SYSTEM_STORE_NAME, mode)
        const store = transaction.objectStore(SYSTEM_STORE_NAME)

        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
        transaction.oncomplete = () => resolve(getResult())

        handler(store)
      }),
  )
}

export function upsertSystemMapEntryByPeriodISO(entry: SystemMapUpsertInput): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(SYSTEM_STORE_NAME, 'readwrite')
        const store = transaction.objectStore(SYSTEM_STORE_NAME)
        const index = store.index(SYSTEM_INDEX_NAME)

        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
        transaction.oncomplete = () => resolve()

        const getExistingRequest = index.get(entry.periodISO)
        getExistingRequest.onerror = () => reject(getExistingRequest.error)
        getExistingRequest.onsuccess = () => {
          const existing = (getExistingRequest.result as SystemMapEntry | undefined) ?? null
          const now = new Date().toISOString()

          const mergedEntry: SystemMapEntry = existing
            ? {
                ...entry,
                id: existing.id,
                createdAt: existing.createdAt,
                updatedAt: now,
              }
            : {
                ...entry,
                id: entry.id ?? crypto.randomUUID(),
                createdAt: entry.createdAt ?? now,
                updatedAt: now,
              }

          const putRequest = store.put(mergedEntry)
          putRequest.onerror = () => reject(putRequest.error)
        }
      }),
  )
}

export function getSystemMapEntryByPeriodISO(periodISO: string): Promise<SystemMapEntry | null> {
  let result: SystemMapEntry | null = null

  return runTransaction(
    'readonly',
    (store) => {
      const request = store.index(SYSTEM_INDEX_NAME).get(periodISO)
      request.onsuccess = () => {
        result = (request.result as SystemMapEntry | undefined) ?? null
      }
    },
    () => result,
  )
}

export function listSystemMapEntries(limit = 6): Promise<SystemMapEntry[]> {
  const entries: SystemMapEntry[] = []

  return runTransaction(
    'readonly',
    (store) => {
      const request = store.index(SYSTEM_INDEX_NAME).openCursor(null, 'prev')
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || entries.length >= limit) {
          return
        }

        entries.push(cursor.value as SystemMapEntry)
        cursor.continue()
      }
    },
    () => entries,
  )
}

export function clearAllSystemMapEntries(): Promise<void> {
  return runTransaction(
    'readwrite',
    (store) => {
      store.clear()
    },
    () => undefined,
  )
}
