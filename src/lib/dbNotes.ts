import { getLocalDayISO } from './date'
import { getOrCreateDeviceId } from './device'
import type { Note, NoteStatus } from './types'

const DB_NAME = 'leiser-db'
const DB_VERSION = 5
const NOTES_STORE = 'notes'
const DAY_INDEX = 'dayISO'
const STATUS_INDEX = 'status'
const CREATED_AT_INDEX = 'createdAt'
const STATUS_CREATED_AT_INDEX = 'status_createdAt'

let dbPromise: Promise<IDBDatabase> | null = null

function asActiveNote(value: unknown): Note | null {
  const note = value as Partial<Note> | undefined
  if (!note || typeof note !== 'object') {
    return null
  }

  if (note.deletedAt !== null && note.deletedAt !== undefined) {
    return null
  }

  return {
    id: String(note.id ?? ''),
    createdAt: String(note.createdAt ?? ''),
    updatedAt: String(note.updatedAt ?? note.createdAt ?? new Date().toISOString()),
    deletedAt: note.deletedAt ?? null,
    deviceId: String(note.deviceId ?? getOrCreateDeviceId()),
    revision: typeof note.revision === 'number' && Number.isFinite(note.revision) ? note.revision : 1,
    dayISO: String(note.dayISO ?? ''),
    text: String(note.text ?? ''),
    status: (note.status as NoteStatus | undefined) ?? 'INBOX',
  }
}

function openDb() {
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        const store = db.createObjectStore(NOTES_STORE, { keyPath: 'id' })
        store.createIndex(DAY_INDEX, DAY_INDEX, { unique: false })
        store.createIndex(STATUS_INDEX, STATUS_INDEX, { unique: false })
        store.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX, { unique: false })
        store.createIndex(STATUS_CREATED_AT_INDEX, [STATUS_INDEX, CREATED_AT_INDEX], { unique: false })
        return
      }

      const transaction = request.transaction
      if (!transaction) {
        return
      }

      const store = transaction.objectStore(NOTES_STORE)
      if (!store.indexNames.contains(DAY_INDEX)) {
        store.createIndex(DAY_INDEX, DAY_INDEX, { unique: false })
      }
      if (!store.indexNames.contains(STATUS_INDEX)) {
        store.createIndex(STATUS_INDEX, STATUS_INDEX, { unique: false })
      }
      if (!store.indexNames.contains(CREATED_AT_INDEX)) {
        store.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX, { unique: false })
      }
      if (!store.indexNames.contains(STATUS_CREATED_AT_INDEX)) {
        store.createIndex(STATUS_CREATED_AT_INDEX, [STATUS_INDEX, CREATED_AT_INDEX], { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

export async function addNote(text: string): Promise<Note> {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('Leerer Text kann nicht gespeichert werden')
  }

  const now = new Date().toISOString()
  const note: Note = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deviceId: getOrCreateDeviceId(),
    revision: 1,
    dayISO: getLocalDayISO(new Date(now)),
    text: trimmed,
    status: 'INBOX',
  }

  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(NOTES_STORE, 'readwrite')
    const store = transaction.objectStore(NOTES_STORE)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()

    const request = store.add(note)
    request.onerror = () => reject(request.error)
  })

  return note
}

export async function listNotesByDay(dayISO: string, limit = 500): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const index = store.index(DAY_INDEX)
    const request = index.openCursor(IDBKeyRange.only(dayISO), 'next')

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => {
      notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      resolve(notes)
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || notes.length >= limit) {
        return
      }

      const note = asActiveNote(cursor.value)
      if (note) {
        notes.push(note)
      }
      cursor.continue()
    }
  })
}

export async function listInboxNotes(limit = 50): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const index = store.index(STATUS_INDEX)
    const request = index.openCursor(IDBKeyRange.only('INBOX'), 'next')

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => {
      notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      resolve(notes)
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || notes.length >= limit) {
        return
      }
      const note = asActiveNote(cursor.value)
      if (note) {
        notes.push(note)
      }
      cursor.continue()
    }
  })
}

export async function listDecidedNotesByDay(dayISO: string, limit = 200): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const index = store.index(DAY_INDEX)
    const request = index.openCursor(IDBKeyRange.only(dayISO), 'next')

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => {
      notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      resolve(notes)
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || notes.length >= limit) {
        return
      }
      const note = asActiveNote(cursor.value)
      if (note && note.status !== 'INBOX') {
        notes.push(note)
      }
      cursor.continue()
    }
  })
}

export async function listProcessNotes(limit = 200): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const index = store.index(STATUS_INDEX)
    const request = index.openCursor(IDBKeyRange.only('PROCESS'), 'next')

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => {
      notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      resolve(notes)
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || notes.length >= limit) {
        return
      }
      const note = asActiveNote(cursor.value)
      if (note) {
        notes.push(note)
      }
      cursor.continue()
    }
  })
}

export async function countInboxNotes(): Promise<number> {
  const db = await openDb()

  return new Promise<number>((resolve, reject) => {
    let count = 0
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const index = store.index(STATUS_INDEX)
    const request = index.openCursor(IDBKeyRange.only('INBOX'), 'next')

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve(count)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        return
      }
      const note = asActiveNote(cursor.value)
      if (note) {
        count += 1
      }
      cursor.continue()
    }
  })
}

export async function deleteNote(id: string): Promise<void> {
  const db = await openDb()

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(NOTES_STORE, 'readwrite')
    const store = transaction.objectStore(NOTES_STORE)
    const getRequest = store.get(id)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()
    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const note = getRequest.result as Note | undefined
      if (!note) {
        return
      }

      const now = new Date().toISOString()
      const putRequest = store.put({
        ...note,
        deletedAt: now,
        updatedAt: now,
        deviceId: note.deviceId ?? getOrCreateDeviceId(),
        revision: (note.revision ?? 1) + 1,
      })
      putRequest.onerror = () => reject(putRequest.error)
    }
  })
}

export async function updateNoteText(id: string, text: string): Promise<void> {
  const db = await openDb()

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(NOTES_STORE, 'readwrite')
    const store = transaction.objectStore(NOTES_STORE)
    const getRequest = store.get(id)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()

    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const note = getRequest.result as Note | undefined
      if (!note) {
        return
      }

      const now = new Date().toISOString()
      const putRequest = store.put({
        ...note,
        text,
        updatedAt: now,
        deviceId: note.deviceId ?? getOrCreateDeviceId(),
        revision: (note.revision ?? 1) + 1,
      })
      putRequest.onerror = () => reject(putRequest.error)
    }
  })
}

export async function updateNoteStatus(id: string, status: NoteStatus): Promise<void> {
  const db = await openDb()

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(NOTES_STORE, 'readwrite')
    const store = transaction.objectStore(NOTES_STORE)
    const getRequest = store.get(id)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()

    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const note = getRequest.result as Note | undefined
      if (!note) {
        return
      }
      const now = new Date().toISOString()
      const putRequest = store.put({
        ...note,
        status,
        updatedAt: now,
        deviceId: note.deviceId ?? getOrCreateDeviceId(),
        revision: (note.revision ?? 1) + 1,
      })
      putRequest.onerror = () => reject(putRequest.error)
    }
  })
}
