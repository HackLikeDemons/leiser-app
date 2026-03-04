import { getLocalDayISO } from './date'
import { getOrCreateDeviceId } from './device'
import { clearNotesStore, getNoteById, listAllNotes, upsertNote } from './dbNotes'
import type { Note, NoteStatus } from './types'

export type ImportMode = 'MERGE' | 'REPLACE'

export type BackupFileV1 = {
  app: 'Leiser'
  schemaVersion: 1
  exportedAt: string
  deviceId: string
  notes: Note[]
}

export type ImportReport = {
  imported: number
  updated: number
  skipped: number
  invalid: number
}

const ALLOWED_STATUSES: NoteStatus[] = ['INBOX', 'TODO', 'PROCESS', 'DISCARD']

function isValidDayISO(dayISO: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dayISO)
}

function toMs(value: string) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

function normalizeImportedNote(raw: unknown, nowISO: string): Note | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const input = raw as Record<string, unknown>
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    return null
  }

  const createdAt = typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : nowISO
  const updatedAt = typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : nowISO

  const dayISO =
    typeof input.dayISO === 'string' && isValidDayISO(input.dayISO)
      ? input.dayISO
      : getLocalDayISO(new Date(createdAt))

  const status =
    typeof input.status === 'string' && ALLOWED_STATUSES.includes(input.status as NoteStatus)
      ? (input.status as NoteStatus)
      : 'INBOX'

  const revision =
    typeof input.revision === 'number' && Number.isFinite(input.revision) && input.revision >= 1
      ? Math.floor(input.revision)
      : 1

  const deviceId =
    typeof input.deviceId === 'string' && input.deviceId.trim() !== ''
      ? input.deviceId
      : 'import'

  const deletedAt =
    input.deletedAt === null || input.deletedAt === undefined
      ? null
      : typeof input.deletedAt === 'string'
        ? input.deletedAt
        : null

  return {
    id: input.id,
    createdAt,
    updatedAt,
    deletedAt,
    deviceId,
    revision,
    dayISO,
    text: typeof input.text === 'string' ? input.text : '',
    status,
  }
}

function importedWins(imported: Note, local: Note) {
  if (imported.revision !== local.revision) {
    return imported.revision > local.revision
  }

  const importedMs = toMs(imported.updatedAt)
  const localMs = toMs(local.updatedAt)
  if (importedMs !== localMs) {
    return importedMs > localMs
  }

  return false
}

export async function buildBackupData(): Promise<BackupFileV1> {
  const notes = await listAllNotes()
  return {
    app: 'Leiser',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    deviceId: getOrCreateDeviceId(),
    notes,
  }
}

export async function importBackupJson(jsonText: string, mode: ImportMode): Promise<ImportReport> {
  const parsed = JSON.parse(jsonText) as Partial<BackupFileV1>

  if (parsed.app !== 'Leiser') {
    throw new Error('Ungültige Datei: app muss "Leiser" sein.')
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error('Ungültige Datei: schemaVersion muss 1 sein.')
  }
  if (!Array.isArray(parsed.notes)) {
    throw new Error('Ungültige Datei: notes muss ein Array sein.')
  }

  const nowISO = new Date().toISOString()
  const report: ImportReport = {
    imported: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
  }

  const normalizedNotes: Note[] = []
  for (const raw of parsed.notes) {
    const note = normalizeImportedNote(raw, nowISO)
    if (!note) {
      report.invalid += 1
      continue
    }
    normalizedNotes.push(note)
  }

  if (mode === 'REPLACE') {
    await clearNotesStore()
    for (const note of normalizedNotes) {
      await upsertNote(note)
      report.imported += 1
    }
    return report
  }

  for (const imported of normalizedNotes) {
    const local = await getNoteById(imported.id)
    if (!local) {
      await upsertNote(imported)
      report.imported += 1
      continue
    }

    if (importedWins(imported, local)) {
      await upsertNote(imported)
      report.updated += 1
      continue
    }

    report.skipped += 1
  }

  return report
}
