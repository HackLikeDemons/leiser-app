export type NoteStatus = 'INBOX' | 'TODO' | 'PROCESS' | 'DISCARD' | 'ARCHIVE'
export type NoteType = 'NOTE' | 'QUESTION' | 'IDEA' | 'TASK'
export type ArchiveBucket = 'THINKING' | 'TODO'
export type ContextTag =
  | 'arbeit'
  | 'familie'
  | 'finanzen'
  | 'freunde'
  | 'gesundheit'
  | 'haushalt'
  | 'privat'
  | 'projekt'

export const CONTEXT_TAGS: ContextTag[] = [
  'arbeit',
  'familie',
  'finanzen',
  'freunde',
  'gesundheit',
  'haushalt',
  'privat',
  'projekt',
]

export function normalizeContextTag(value: unknown): ContextTag | undefined {
  return typeof value === 'string' && CONTEXT_TAGS.includes(value as ContextTag)
    ? (value as ContextTag)
    : undefined
}

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
  starred: boolean
  archiveBucket?: ArchiveBucket | null
  context?: ContextTag
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
  syncToken: string | null
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
  payload: unknown[]
  signerDeviceId?: string
  signerPublicKey?: string
  signature?: string
  snapshot?: Note
}

export type InboxSeen = {
  key: string
  seenAt: string
  expiresAt: string | null
}
