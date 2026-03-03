import type { WeekEntry } from '../weekEntry'

const DB_NAME = 'leiser-db'
const DB_VERSION = 1
const STORE_NAME = 'weekEntries'
const WEEK_INDEX = 'weekStartISO'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb() {
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex(WEEK_INDEX, WEEK_INDEX, { unique: true })
        return
      }

      const transaction = request.transaction
      if (!transaction) {
        return
      }

      const store = transaction.objectStore(STORE_NAME)
      if (!store.indexNames.contains(WEEK_INDEX)) {
        store.createIndex(WEEK_INDEX, WEEK_INDEX, { unique: true })
      }
    }

    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => void,
  getResult: () => T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode)
        const store = transaction.objectStore(STORE_NAME)

        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
        transaction.oncomplete = () => resolve(getResult())

        handler(store)
      }),
  )
}

export function upsertWeekEntry(entry: WeekEntry): Promise<void> {
  return runTransaction(
    'readwrite',
    (store) => {
      store.put(entry)
    },
    () => undefined,
  )
}

export function getWeekEntryByWeekStart(weekStartISO: string): Promise<WeekEntry | null> {
  let result: WeekEntry | null = null

  return runTransaction(
    'readonly',
    (store) => {
      const request = store.index(WEEK_INDEX).get(weekStartISO)
      request.onsuccess = () => {
        result = (request.result as WeekEntry | undefined) ?? null
      }
    },
    () => result,
  )
}

export function listWeekEntries(limit = 12): Promise<WeekEntry[]> {
  const entries: WeekEntry[] = []

  return runTransaction(
    'readonly',
    (store) => {
      const request = store.index(WEEK_INDEX).openCursor(null, 'prev')
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || entries.length >= limit) {
          return
        }

        entries.push(cursor.value as WeekEntry)
        cursor.continue()
      }
    },
    () => entries,
  )
}

export function deleteWeekEntry(id: string): Promise<void> {
  return runTransaction(
    'readwrite',
    (store) => {
      store.delete(id)
    },
    () => undefined,
  )
}
