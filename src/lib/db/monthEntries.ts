import type { MonthEntry } from '../monthEntry'
import { MONTH_INDEX_NAME, MONTH_STORE_NAME, openDb } from './db'

function runTransaction<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => void,
  getResult: () => T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(MONTH_STORE_NAME, mode)
        const store = transaction.objectStore(MONTH_STORE_NAME)

        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
        transaction.oncomplete = () => resolve(getResult())

        handler(store)
      }),
  )
}

type MonthEntryUpsertInput = Omit<MonthEntry, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<MonthEntry, 'id' | 'createdAt' | 'updatedAt'>>

export function upsertMonthEntryByMonthISO(entry: MonthEntryUpsertInput): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(MONTH_STORE_NAME, 'readwrite')
        const store = transaction.objectStore(MONTH_STORE_NAME)
        const index = store.index(MONTH_INDEX_NAME)

        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
        transaction.oncomplete = () => resolve()

        const getExistingRequest = index.get(entry.monthISO)
        getExistingRequest.onerror = () => reject(getExistingRequest.error)
        getExistingRequest.onsuccess = () => {
          const existing = (getExistingRequest.result as MonthEntry | undefined) ?? null
          const now = new Date().toISOString()

          const mergedEntry: MonthEntry = existing
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

export function upsertMonthEntry(entry: MonthEntry): Promise<void> {
  return upsertMonthEntryByMonthISO(entry)
}

export function getMonthEntryByMonthISO(monthISO: string): Promise<MonthEntry | null> {
  let result: MonthEntry | null = null

  return runTransaction(
    'readonly',
    (store) => {
      const request = store.index(MONTH_INDEX_NAME).get(monthISO)
      request.onsuccess = () => {
        result = (request.result as MonthEntry | undefined) ?? null
      }
    },
    () => result,
  )
}

export function listMonthEntries(limit = 6): Promise<MonthEntry[]> {
  const entries: MonthEntry[] = []

  return runTransaction(
    'readonly',
    (store) => {
      const request = store.index(MONTH_INDEX_NAME).openCursor(null, 'prev')
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || entries.length >= limit) {
          return
        }

        entries.push(cursor.value as MonthEntry)
        cursor.continue()
      }
    },
    () => entries,
  )
}

export function clearAllMonthEntries(): Promise<void> {
  return runTransaction(
    'readwrite',
    (store) => {
      store.clear()
    },
    () => undefined,
  )
}
