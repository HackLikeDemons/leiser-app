export type NoteStatus = 'INBOX' | 'TODO' | 'PROCESS' | 'DISCARD' | 'ARCHIVE'
export type NoteType = 'NOTE' | 'QUESTION' | 'IDEA' | 'TASK'

export type Note = {
  id: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  deviceId: string
  revision: number
  dayISO: string
  text: string
  status: NoteStatus
  type: NoteType
}

export type NotesView = Note

export type CrdtDoc = {
  noteId: string
  docBinary: ArrayBuffer
  updatedAt: string
  schemaVersion: number
}

export type SyncState = {
  roomId: string
  lastPulledSeq: number
  lastPushedAt: string | null
  lastError: string | null
  isEnabled: boolean
}

export type OutboxChange = {
  changeId: string
  roomId: string
  noteId: string
  bytes: ArrayBuffer
  createdAt: string
  sentAt: string | null
  attemptCount: number
}

export type ChangeEnvelope = {
  changeId: string
  roomId: string
  deviceId: string
  noteId: string
  ts: number
  kind: 'automerge_changes_v1'
  payload: string[]
}

export type InboxSeen = {
  key: string
  seenAt: string
  expiresAt: string | null
}
