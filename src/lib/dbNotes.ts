import * as Automerge from '@automerge/automerge/slim'
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64'
import { getLocalDayISO } from './date'
import { getOrCreateDeviceId } from './device'
import type { ChangeEnvelope, Note, NoteStatus, NoteType } from './types'

const DB_NAME = 'leiser-db'
const DB_VERSION = 9

const NOTES_STORE = 'notes'
const NOTES_VIEW_STORE = 'notes_view'
const CRDT_DOCS_STORE = 'crdt_docs'
const SYNC_STATE_STORE = 'sync_state'
const OUTBOX_STORE = 'outbox'
const INBOX_SEEN_STORE = 'inbox_seen'

const DAY_INDEX = 'dayISO'
const STATUS_INDEX = 'status'
const CREATED_AT_INDEX = 'createdAt'
const UPDATED_AT_INDEX = 'updatedAt'
const STATUS_CREATED_AT_INDEX = 'status_createdAt'
const STATUS_UPDATED_AT_INDEX = 'status_updatedAt'

const ROOM_INDEX = 'roomId'
const SENT_AT_INDEX = 'sentAt'
const CHANGE_CREATED_AT_INDEX = 'createdAt'
const EXPIRES_AT_INDEX = 'expiresAt'

const CRDT_SCHEMA_VERSION = 1
const DEFAULT_ROOM_ID = 'default'
const CHANGE_KIND = 'automerge_changes_v1'

const ALLOWED_NOTE_TYPES: NoteType[] = ['NOTE', 'QUESTION', 'IDEA', 'TASK']
const ALLOWED_NOTE_STATUSES: NoteStatus[] = ['INBOX', 'TODO', 'PROCESS', 'DISCARD', 'ARCHIVE']

let dbPromise: Promise<IDBDatabase> | null = null
let automergeInitPromise: Promise<void> | null = null

type CrdtNoteDoc = {
  text: string
  status: NoteStatus
  type: NoteType
  createdAt: number
  updatedAt: number
  dayISO: string
  deletedAt: number | null
  revision: number
  originDeviceId: string
  lastModifiedDeviceId: string
}

type SyncStateRow = {
  roomId: string
  lastPulledSeq: number
  lastPushedAt: string | null
  lastError: string | null
  isEnabled: boolean
}

function toEpochMs(value: string) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function msToIso(value: number) {
  return new Date(value).toISOString()
}

function normalizeStatus(status: unknown): NoteStatus {
  return typeof status === 'string' && ALLOWED_NOTE_STATUSES.includes(status as NoteStatus)
    ? (status as NoteStatus)
    : 'INBOX'
}

function normalizeType(type: unknown): NoteType {
  return typeof type === 'string' && ALLOWED_NOTE_TYPES.includes(type as NoteType)
    ? (type as NoteType)
    : 'NOTE'
}

function noteToCrdtDoc(note: Note): CrdtNoteDoc {
  return {
    text: note.text,
    status: normalizeStatus(note.status),
    type: normalizeType(note.type),
    createdAt: toEpochMs(note.createdAt),
    updatedAt: toEpochMs(note.updatedAt),
    dayISO: note.dayISO,
    deletedAt: note.deletedAt ? toEpochMs(note.deletedAt) : null,
    revision: Math.max(1, note.revision || 1),
    originDeviceId: note.deviceId || getOrCreateDeviceId(),
    lastModifiedDeviceId: note.deviceId || getOrCreateDeviceId(),
  }
}

function crdtDocToNote(noteId: string, doc: CrdtNoteDoc): Note {
  const createdAtIso = msToIso(doc.createdAt)
  return {
    id: noteId,
    createdAt: createdAtIso,
    updatedAt: msToIso(doc.updatedAt),
    deletedAt: doc.deletedAt ? msToIso(doc.deletedAt) : null,
    deviceId: doc.lastModifiedDeviceId || doc.originDeviceId || getOrCreateDeviceId(),
    revision: Math.max(1, doc.revision || 1),
    dayISO: doc.dayISO || getLocalDayISO(new Date(createdAtIso)),
    text: typeof doc.text === 'string' ? doc.text : '',
    status: normalizeStatus(doc.status),
    type: normalizeType(doc.type),
  }
}

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
    status: normalizeStatus(note.status),
    type: normalizeType(note.type),
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

function createNoteIndexes(store: IDBObjectStore) {
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

function ensureSyncStateDefaults(store: IDBObjectStore, roomId: string) {
  const request = store.get(roomId)
  request.onsuccess = () => {
    if (request.result) {
      return
    }
    const row: SyncStateRow = {
      roomId,
      lastPulledSeq: 0,
      lastPushedAt: null,
      lastError: null,
      isEnabled: false,
    }
    store.put(row)
  }
}

function createEmptyCrdtDoc() {
  const now = Date.now()
  return Automerge.from<CrdtNoteDoc>({
    text: '',
    status: 'INBOX',
    type: 'NOTE',
    createdAt: now,
    updatedAt: now,
    dayISO: getLocalDayISO(new Date(now)),
    deletedAt: null,
    revision: 1,
    originDeviceId: getOrCreateDeviceId(),
    lastModifiedDeviceId: getOrCreateDeviceId(),
  })
}

function buildDocFromPayload(payload: CrdtNoteDoc) {
  const base = Automerge.init<CrdtNoteDoc>()
  const doc = Automerge.change(base, (draft: CrdtNoteDoc) => {
    draft.text = payload.text
    draft.status = payload.status
    draft.type = payload.type
    draft.createdAt = payload.createdAt
    draft.updatedAt = payload.updatedAt
    draft.dayISO = payload.dayISO
    draft.deletedAt = payload.deletedAt
    draft.revision = payload.revision
    draft.originDeviceId = payload.originDeviceId
    draft.lastModifiedDeviceId = payload.lastModifiedDeviceId
  })
  return { base, doc }
}

function saveCrdtDoc(doc: Automerge.Doc<CrdtNoteDoc>) {
  return Automerge.save(doc)
}

function loadCrdtDoc(binary: Uint8Array) {
  return Automerge.load<CrdtNoteDoc>(binary)
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  return new Uint8Array(value as ArrayLike<number>)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function openDb() {
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = (async () => {
    if (!automergeInitPromise) {
      automergeInitPromise = Automerge.initializeBase64Wasm(automergeWasmBase64) as Promise<void>
    }
    await automergeInitPromise

    return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)

    request.onupgradeneeded = (event) => {
      const oldVersion = event.oldVersion
      const db = request.result
      const transaction = request.transaction
      if (!transaction) {
        return
      }

      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        const notesStore = db.createObjectStore(NOTES_STORE, { keyPath: 'id' })
        createNoteIndexes(notesStore)
      }
      const notesStore = transaction.objectStore(NOTES_STORE)
      createNoteIndexes(notesStore)

      let notesViewStore: IDBObjectStore
      if (!db.objectStoreNames.contains(NOTES_VIEW_STORE)) {
        notesViewStore = db.createObjectStore(NOTES_VIEW_STORE, { keyPath: 'id' })
      } else {
        notesViewStore = transaction.objectStore(NOTES_VIEW_STORE)
      }
      createNoteIndexes(notesViewStore)

      if (!db.objectStoreNames.contains(CRDT_DOCS_STORE)) {
        const crdtStore = db.createObjectStore(CRDT_DOCS_STORE, { keyPath: 'noteId' })
        crdtStore.createIndex(UPDATED_AT_INDEX, UPDATED_AT_INDEX, { unique: false })
      } else {
        const crdtStore = transaction.objectStore(CRDT_DOCS_STORE)
        if (!crdtStore.indexNames.contains(UPDATED_AT_INDEX)) {
          crdtStore.createIndex(UPDATED_AT_INDEX, UPDATED_AT_INDEX, { unique: false })
        }
      }

      if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
        const syncStore = db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'roomId' })
        ensureSyncStateDefaults(syncStore, DEFAULT_ROOM_ID)
      } else {
        ensureSyncStateDefaults(transaction.objectStore(SYNC_STATE_STORE), DEFAULT_ROOM_ID)
      }

      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const outboxStore = db.createObjectStore(OUTBOX_STORE, { keyPath: 'changeId' })
        outboxStore.createIndex(ROOM_INDEX, ROOM_INDEX, { unique: false })
        outboxStore.createIndex(CHANGE_CREATED_AT_INDEX, CHANGE_CREATED_AT_INDEX, { unique: false })
        outboxStore.createIndex(SENT_AT_INDEX, SENT_AT_INDEX, { unique: false })
      } else {
        const outboxStore = transaction.objectStore(OUTBOX_STORE)
        if (!outboxStore.indexNames.contains(ROOM_INDEX)) {
          outboxStore.createIndex(ROOM_INDEX, ROOM_INDEX, { unique: false })
        }
        if (!outboxStore.indexNames.contains(CHANGE_CREATED_AT_INDEX)) {
          outboxStore.createIndex(CHANGE_CREATED_AT_INDEX, CHANGE_CREATED_AT_INDEX, { unique: false })
        }
        if (!outboxStore.indexNames.contains(SENT_AT_INDEX)) {
          outboxStore.createIndex(SENT_AT_INDEX, SENT_AT_INDEX, { unique: false })
        }
      }

      if (!db.objectStoreNames.contains(INBOX_SEEN_STORE)) {
        const seenStore = db.createObjectStore(INBOX_SEEN_STORE, { keyPath: 'key' })
        seenStore.createIndex(CREATED_AT_INDEX, 'seenAt', { unique: false })
        seenStore.createIndex(EXPIRES_AT_INDEX, EXPIRES_AT_INDEX, { unique: false })
      } else {
        const seenStore = transaction.objectStore(INBOX_SEEN_STORE)
        if (!seenStore.indexNames.contains(CREATED_AT_INDEX)) {
          seenStore.createIndex(CREATED_AT_INDEX, 'seenAt', { unique: false })
        }
        if (!seenStore.indexNames.contains(EXPIRES_AT_INDEX)) {
          seenStore.createIndex(EXPIRES_AT_INDEX, EXPIRES_AT_INDEX, { unique: false })
        }
      }

      // Migration/backfill for notes_view + CRDT docs
      if (oldVersion < 9) {
        const crdtStore = transaction.objectStore(CRDT_DOCS_STORE)
        const backfill = notesStore.openCursor()
        backfill.onsuccess = () => {
          const cursor = backfill.result
          if (!cursor) {
            return
          }
          const note = asStoredNote(cursor.value)
          if (note) {
            notesViewStore.put(note)
            const { doc } = buildDocFromPayload(noteToCrdtDoc(note))
            crdtStore.put({
              noteId: note.id,
              docBinary: saveCrdtDoc(doc),
              updatedAt: note.updatedAt,
              schemaVersion: CRDT_SCHEMA_VERSION,
            })
          }
          cursor.continue()
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
    })
  })()

  return dbPromise
}

function materializeFromDoc(noteId: string, doc: Automerge.Doc<CrdtNoteDoc>): Note {
  return crdtDocToNote(noteId, {
    text: doc.text,
    status: doc.status,
    type: doc.type,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    dayISO: doc.dayISO,
    deletedAt: doc.deletedAt ?? null,
    revision: doc.revision,
    originDeviceId: doc.originDeviceId,
    lastModifiedDeviceId: doc.lastModifiedDeviceId,
  })
}

async function persistDocAndViews(noteId: string, doc: Automerge.Doc<CrdtNoteDoc>): Promise<Note> {
  const db = await openDb()
  const note = materializeFromDoc(noteId, doc)
  const binary = saveCrdtDoc(doc)

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([NOTES_STORE, NOTES_VIEW_STORE, CRDT_DOCS_STORE], 'readwrite')
    const notesStore = transaction.objectStore(NOTES_STORE)
    const notesViewStore = transaction.objectStore(NOTES_VIEW_STORE)
    const crdtStore = transaction.objectStore(CRDT_DOCS_STORE)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()

    const r1 = notesStore.put(note)
    r1.onerror = () => reject(r1.error)
    const r2 = notesViewStore.put(note)
    r2.onerror = () => reject(r2.error)
    const r3 = crdtStore.put({
      noteId,
      docBinary: binary,
      updatedAt: note.updatedAt,
      schemaVersion: CRDT_SCHEMA_VERSION,
    })
    r3.onerror = () => reject(r3.error)
  })

  return note
}

async function loadDocForNote(noteId: string): Promise<Automerge.Doc<CrdtNoteDoc> | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CRDT_DOCS_STORE, NOTES_STORE], 'readonly')
    const crdtStore = transaction.objectStore(CRDT_DOCS_STORE)
    const notesStore = transaction.objectStore(NOTES_STORE)
    const crdtRequest = crdtStore.get(noteId)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    crdtRequest.onerror = () => reject(crdtRequest.error)
    crdtRequest.onsuccess = () => {
      const row = crdtRequest.result as { docBinary?: Uint8Array | ArrayBuffer } | undefined
      const bytes = row?.docBinary
        ? row.docBinary instanceof Uint8Array
          ? row.docBinary
          : new Uint8Array(row.docBinary)
        : null
      if (bytes) {
        resolve(loadCrdtDoc(bytes))
        return
      }

      const noteRequest = notesStore.get(noteId)
      noteRequest.onerror = () => reject(noteRequest.error)
      noteRequest.onsuccess = () => {
        const note = asStoredNote(noteRequest.result)
        if (!note) {
          resolve(null)
          return
        }
        const { doc } = buildDocFromPayload(noteToCrdtDoc(note))
        resolve(doc)
      }
    }
  })
}

async function enqueueAutomergeChanges(
  noteId: string,
  changes: unknown[],
  roomId = DEFAULT_ROOM_ID,
): Promise<void> {
  if (!changes.length) {
    return
  }

  const payload = changes.map((change) => bytesToBase64(toUint8Array(change)))
  const ts = Date.now()
  const envelope: ChangeEnvelope = {
    changeId: crypto.randomUUID(),
    roomId,
    deviceId: getOrCreateDeviceId(),
    noteId,
    ts,
    kind: CHANGE_KIND,
    payload,
  }

  const bytes = new TextEncoder().encode(JSON.stringify(envelope))
  const db = await openDb()

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX_STORE, 'readwrite')
    const outbox = transaction.objectStore(OUTBOX_STORE)
    const req = outbox.put({
      changeId: envelope.changeId,
      roomId: envelope.roomId,
      noteId: envelope.noteId,
      bytes: bytes.buffer,
      createdAt: new Date(ts).toISOString(),
      sentAt: null,
      attemptCount: 0,
    })

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function addNote(text: string): Promise<Note> {
  return createNote(text)
}

export async function createNote(text: string): Promise<Note> {
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

  const { base, doc } = buildDocFromPayload(noteToCrdtDoc(note))
  const changes = Automerge.getChanges(base, doc)
  const created = await persistDocAndViews(note.id, doc)
  await enqueueAutomergeChanges(note.id, changes as unknown[])
  return created
}

export async function applyLocalEdit(
  noteId: string,
  mutator: (draft: CrdtNoteDoc) => void,
): Promise<Note | null> {
  const existing = await loadDocForNote(noteId)
  if (!existing) {
    return null
  }

  const now = Date.now()
  const deviceId = getOrCreateDeviceId()
  const updatedDoc = Automerge.change(existing, (draft: CrdtNoteDoc) => {
    mutator(draft)
    draft.updatedAt = now
    draft.revision = Math.max(1, draft.revision || 1) + 1
    draft.lastModifiedDeviceId = deviceId
    if (!draft.dayISO) {
      draft.dayISO = getLocalDayISO(new Date(draft.createdAt || now))
    }
  })

  const changes = Automerge.getChanges(existing, updatedDoc)
  const updated = await persistDocAndViews(noteId, updatedDoc)
  await enqueueAutomergeChanges(noteId, changes as unknown[])
  return updated
}

export async function applyRemoteChanges(noteId: string, changesBytes: Uint8Array[]): Promise<Note | null> {
  if (changesBytes.length === 0) {
    return getNoteById(noteId)
  }

  const existing = (await loadDocForNote(noteId)) ?? createEmptyCrdtDoc()
  const [docAfter] = Automerge.applyChanges(existing, changesBytes as unknown as Automerge.Change[])
  return persistDocAndViews(noteId, docAfter)
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
    request.onsuccess = () => resolve(asStoredNote(request.result))
  })
}

export async function upsertNote(note: Note): Promise<void> {
  const { doc } = buildDocFromPayload(noteToCrdtDoc(note))
  await persistDocAndViews(note.id, doc)
}

export async function clearNotesStore(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([NOTES_STORE, NOTES_VIEW_STORE, CRDT_DOCS_STORE], 'readwrite')

    const r1 = transaction.objectStore(NOTES_STORE).clear()
    const r2 = transaction.objectStore(NOTES_VIEW_STORE).clear()
    const r3 = transaction.objectStore(CRDT_DOCS_STORE).clear()

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()
    r1.onerror = () => reject(r1.error)
    r2.onerror = () => reject(r2.error)
    r3.onerror = () => reject(r3.error)
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

export async function listRecentActiveNotes(limit = 500): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_VIEW_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_VIEW_STORE)
    const index = store.index(CREATED_AT_INDEX)
    const request = index.openCursor(null, 'prev')

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

export async function listNotesByDay(dayISO: string, limit = 500): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_VIEW_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_VIEW_STORE)
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

export async function listSearchableNotes(): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_VIEW_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_VIEW_STORE)
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

export async function listInboxNotes(limit = 50): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_VIEW_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_VIEW_STORE)
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
    const transaction = db.transaction(NOTES_VIEW_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_VIEW_STORE)
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

export async function listTodoNotes(limit = 200): Promise<Note[]> {
  const db = await openDb()

  return new Promise<Note[]>((resolve, reject) => {
    const notes: Note[] = []
    const transaction = db.transaction(NOTES_VIEW_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_VIEW_STORE)
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
    const transaction = db.transaction(NOTES_VIEW_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_VIEW_STORE)
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

export async function listProcessNotes(limit = 200): Promise<Note[]> {
  return listNotesByStatus('PROCESS', limit)
}

export async function countNotesByStatus(status: NoteStatus): Promise<number> {
  const db = await openDb()

  return new Promise<number>((resolve, reject) => {
    let count = 0
    const transaction = db.transaction(NOTES_VIEW_STORE, 'readonly')
    const store = transaction.objectStore(NOTES_VIEW_STORE)
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
  return countNotesByStatus('INBOX')
}

export async function deleteNote(id: string): Promise<void> {
  await applyLocalEdit(id, (doc) => {
    doc.deletedAt = Date.now()
  })
}

export async function updateNoteText(id: string, text: string): Promise<void> {
  await applyLocalEdit(id, (doc) => {
    doc.text = text
  })
}

export async function updateNoteStatus(id: string, status: NoteStatus): Promise<void> {
  await applyLocalEdit(id, (doc) => {
    doc.status = status
  })
}

export type SyncDebugInfo = {
  deviceId: string
  roomId: string
  lastPulledSeq: number
}

export async function getSyncDebugInfo(roomId = DEFAULT_ROOM_ID): Promise<SyncDebugInfo> {
  const db = await openDb()
  return new Promise<SyncDebugInfo>((resolve, reject) => {
    const transaction = db.transaction(SYNC_STATE_STORE, 'readwrite')
    const store = transaction.objectStore(SYNC_STATE_STORE)
    const request = store.get(roomId)

    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const existing = request.result as { lastPulledSeq?: number } | undefined
      if (!existing) {
        const row: SyncStateRow = {
          roomId,
          lastPulledSeq: 0,
          lastPushedAt: null,
          lastError: null,
          isEnabled: false,
        }
        store.put(row)
        resolve({
          deviceId: getOrCreateDeviceId(),
          roomId,
          lastPulledSeq: 0,
        })
        return
      }

      resolve({
        deviceId: getOrCreateDeviceId(),
        roomId,
        lastPulledSeq:
          typeof existing.lastPulledSeq === 'number' && Number.isFinite(existing.lastPulledSeq)
            ? existing.lastPulledSeq
            : 0,
      })
    }
  })
}
