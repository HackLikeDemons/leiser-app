const DB_NAME = 'leiser-db'
const DB_VERSION = 3

export const WEEK_STORE_NAME = 'weekEntries'
export const WEEK_INDEX_NAME = 'weekStartISO'
export const MONTH_STORE_NAME = 'monthEntries'
export const MONTH_INDEX_NAME = 'monthISO'
export const SYSTEM_STORE_NAME = 'systemMapEntries'
export const SYSTEM_INDEX_NAME = 'periodISO'

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb() {
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(WEEK_STORE_NAME)) {
        const store = db.createObjectStore(WEEK_STORE_NAME, { keyPath: 'id' })
        store.createIndex(WEEK_INDEX_NAME, WEEK_INDEX_NAME, { unique: true })
      } else {
        const transaction = request.transaction
        if (transaction) {
          const store = transaction.objectStore(WEEK_STORE_NAME)
          if (!store.indexNames.contains(WEEK_INDEX_NAME)) {
            store.createIndex(WEEK_INDEX_NAME, WEEK_INDEX_NAME, { unique: true })
          }
        }
      }

      if (!db.objectStoreNames.contains(MONTH_STORE_NAME)) {
        const store = db.createObjectStore(MONTH_STORE_NAME, { keyPath: 'id' })
        store.createIndex(MONTH_INDEX_NAME, MONTH_INDEX_NAME, { unique: true })
      } else {
        const transaction = request.transaction
        if (transaction) {
          const store = transaction.objectStore(MONTH_STORE_NAME)
          if (!store.indexNames.contains(MONTH_INDEX_NAME)) {
            store.createIndex(MONTH_INDEX_NAME, MONTH_INDEX_NAME, { unique: true })
          }
        }
      }

      if (!db.objectStoreNames.contains(SYSTEM_STORE_NAME)) {
        const store = db.createObjectStore(SYSTEM_STORE_NAME, { keyPath: 'id' })
        store.createIndex(SYSTEM_INDEX_NAME, SYSTEM_INDEX_NAME, { unique: true })
      } else {
        const transaction = request.transaction
        if (transaction) {
          const store = transaction.objectStore(SYSTEM_STORE_NAME)
          if (!store.indexNames.contains(SYSTEM_INDEX_NAME)) {
            store.createIndex(SYSTEM_INDEX_NAME, SYSTEM_INDEX_NAME, { unique: true })
          }
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}
