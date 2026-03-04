import { getLocalDayISO } from './date'
import { getOrCreateDeviceId } from './device'
import type { Note, NoteStatus, NoteType } from './types'

const DB_NAME = 'leiser-db'
const DB_VERSION = 6
const NOTES_STORE = 'notes'
const DAY_INDEX = 'dayISO'
const STATUS_INDEX = 'status'
const CREATED_AT_INDEX = 'createdAt'
const UPDATED_AT_INDEX = 'updatedAt'
const STATUS_CREATED_AT_INDEX = 'status_createdAt'
const STATUS_UPDATED_AT_INDEX = 'status_updatedAt'
const ALLOWED_NOTE_TYPES: NoteType[] = ['NOTE', 'QUESTION', 'IDEA', 'TASK']

let dbPromise: Promise<IDBDatabase> | null = null

function asStoredNote(value: unknown): Note | null {
  const note = value as Partial<Note> | undefined
  if (!note || typeof note !== 'object') {
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
    type:
      typeof note.type === 'string' && ALLOWED_NOTE_TYPES.includes(note.type as NoteType)
        ? (note.type as NoteType)
        : 'NOTE',
  }
}

function asActiveNote(value: unknown): Note | null {
  const note = asStoredNote(value)
  if (!note) {
    return null
  }

  if (note.deletedAt !== null && note.deletedAt !== undefined) {
    return null
  }

  return note
}

function parseNoteInput(rawText: string): { text: string; type: NoteType; status: NoteStatus } {
  const leftTrimmed = rawText.trimStart()
  let type: NoteType = 'NOTE'
  let remainder = leftTrimmed

  const prefix = leftTrimmed[0]
  if (prefix === '?') {
    type = 'QUESTION'
    remainder = leftTrimmed.slice(1)
  } else if (prefix === '!') {
    type = 'IDEA'
    remainder = leftTrimmed.slice(1)
  } else if (prefix === '-') {
    type = 'TASK'
    remainder = leftTrimmed.slice(1)
  }

  if (type !== 'NOTE' && remainder.startsWith(' ')) {
    remainder = remainder.slice(1)
  }

  const text = remainder.trim()
  const status: NoteStatus = type === 'TASK' ? 'TODO' : 'INBOX'
  return { text, type, status }
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
        store.createIndex(UPDATED_AT_INDEX, UPDATED_AT_INDEX, { unique: false })
        store.createIndex(STATUS_CREATED_AT_INDEX, [STATUS_INDEX, CREATED_AT_INDEX], { unique: false })
        store.createIndex(STATUS_UPDATED_AT_INDEX, [STATUS_INDEX, UPDATED_AT_INDEX], { unique: false })
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
      if (!store.indexNames.contains(UPDATED_AT_INDEX)) {
        store.createIndex(UPDATED_AT_INDEX, UPDATED_AT_INDEX, { unique: false })
      }
      if (!store.indexNames.contains(STATUS_CREATED_AT_INDEX)) {
        store.createIndex(STATUS_CREATED_AT_INDEX, [STATUS_INDEX, CREATED_AT_INDEX], { unique: false })
      }
      if (!store.indexNames.contains(STATUS_UPDATED_AT_INDEX)) {
        store.createIndex(STATUS_UPDATED_AT_INDEX, [STATUS_INDEX, UPDATED_AT_INDEX], { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

export async function addNote(text: string): Promise<Note> {
  const parsed = parseNoteInput(text)
  if (!parsed.text) {
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
    text: parsed.text,
    status: parsed.status,
    type: parsed.type,
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

export async function listAllNotes(): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const request = store.openCursor()

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => {
      notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      resolve(notes)
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        return
      }

      const note = asStoredNote(cursor.value)
      if (note) {
        notes.push(note)
      }
      cursor.continue()
    }
  })
}

export async function listSearchableNotes(): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const request = store.openCursor()

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve(notes)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        return
      }

      const note = asActiveNote(cursor.value)
      if (note && note.status !== 'DISCARD') {
        notes.push(note)
      }
      cursor.continue()
    }
  })
}

export async function getNoteById(id: string): Promise<Note | null> {
  const db = await openDb()

  return new Promise<Note | null>((resolve, reject) => {
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const request = store.get(id)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      resolve(asStoredNote(request.result))
    }
  })
}

export async function upsertNote(note: Note): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(NOTES_STORE, 'readwrite')
    const store = transaction.objectStore(NOTES_STORE)
    const request = store.put(note)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function clearNotesStore(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(NOTES_STORE, 'readwrite')
    const store = transaction.objectStore(NOTES_STORE)
    const request = store.clear()

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()
    request.onerror = () => reject(request.error)
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
  return listNotesByStatus('PROCESS', limit)
}

export async function listTodoNotes(limit = 200): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const index = store.index(STATUS_INDEX)
    const request = index.openCursor(IDBKeyRange.only('TODO'), 'next')

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

export async function listNotesByStatus(status: NoteStatus, limit = 200): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const index = store.index(STATUS_UPDATED_AT_INDEX)
    const lower = [status, '']
    const upper = [status, '\uffff']
    const request = index.openCursor(IDBKeyRange.bound(lower, upper), 'prev')

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve(notes)

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

export async function countNotesByStatus(status: NoteStatus): Promise<number> {
  const db = await openDb()

  return new Promise<number>((resolve, reject) => {
    let count = 0
    const transaction = db.transaction(NOTES_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_STORE)
    const index = store.index(STATUS_INDEX)
    const request = index.openCursor(IDBKeyRange.only(status), 'next')

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
