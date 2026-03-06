import {
  DEFAULT_SYNC_ROOM_ID,
  applyRemoteChanges,
  bumpOutboxAttempt,
  decodeChangePayload,
  decodeOutboxEnvelope,
  enqueueMissingRoomSnapshots,
  getNoteById,
  getSyncState,
  listPendingOutboxChanges,
  markOutboxChangesSent,
  upsertNote,
  updateSyncState,
} from './dbNotes'
import { pullSync, pushSync, REMOTE_CHANGED_ERROR, type SyncBlob } from './sync/supabaseAdapter'
import { verifyTrustedEnvelope } from './syncSigning'
import { normalizeContextTag } from './types'
import type { ChangeEnvelope, Note } from './types'

type SyncUiStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled'

type SyncDiagnostics = {
  atISO: string
  mode: 'pull' | 'push'
  remoteEnvelopesSeen: number
  remoteEnvelopesApplied: number
  snapshotApplied: number
  changeApplied: number
  snapshotRescues: number
  signatureRejected: number
  remoteChangedRetries: number
  pendingOutboxCount: number
}

type SyncEngineOptions = {
  roomId?: string
  debounceMs?: number
  pullIntervalMs?: number
  onStatusChange?: (status: SyncUiStatus, error?: string | null) => void
  onDataChanged?: () => void
  onDiagnostics?: (diagnostics: SyncDiagnostics) => void
}

type SyncNowOptions = {
  roomId?: string
  onStatusChange?: (status: SyncUiStatus, error?: string | null) => void
  onDataChanged?: () => void
  onDiagnostics?: (diagnostics: SyncDiagnostics) => void
}

type MergeResult = {
  applied: boolean
  remoteEnvelopes: ChangeEnvelope[]
  remoteSeen: number
  snapshotsApplied: number
  changesApplied: number
  signatureRejected: number
}

const DEFAULT_DEBOUNCE_MS = 1200
const DEFAULT_PULL_INTERVAL_MS = 90000

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  return fallback
}

function toEpochMs(value: string | null | undefined): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function asSyncEnvelope(value: unknown): ChangeEnvelope | null {
  const item = value as Partial<ChangeEnvelope> | null
  if (!item) {
    return null
  }
  if (
    typeof item.changeId !== 'string' ||
    typeof item.roomId !== 'string' ||
    typeof item.noteId !== 'string' ||
    !Array.isArray(item.payload)
  ) {
    return null
  }
  return item as ChangeEnvelope
}

function asSnapshotNote(value: unknown, noteId: string): Note | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const note = value as Partial<Note>
  if (typeof note.createdAt !== 'string' || typeof note.updatedAt !== 'string' || typeof note.dayISO !== 'string') {
    return null
  }
  const context = normalizeContextTag(note.context)
  return {
    id: noteId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt ?? null,
    deviceId: typeof note.deviceId === 'string' ? note.deviceId : '',
    revision: typeof note.revision === 'number' && Number.isFinite(note.revision) ? note.revision : 1,
    dayISO: note.dayISO,
    text: typeof note.text === 'string' ? note.text : '',
    status:
      note.status === 'INBOX' || note.status === 'TODO' || note.status === 'PROCESS' || note.status === 'DISCARD' || note.status === 'ARCHIVE'
        ? note.status
        : 'INBOX',
    type: note.type === 'QUESTION' || note.type === 'IDEA' || note.type === 'TASK' || note.type === 'NOTE' ? note.type : 'NOTE',
    starred: Boolean(note.starred),
    archiveBucket: note.archiveBucket === 'THINKING' || note.archiveBucket === 'TODO' ? note.archiveBucket : null,
    context,
  }
}

function asSyncBlob(value: unknown): SyncBlob | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const blob = value as Partial<SyncBlob>
  if (blob.version !== 1 || !Array.isArray(blob.changes)) {
    return null
  }
  return { version: 1, changes: blob.changes }
}

function createEmptyMergeResult(): MergeResult {
  return {
    applied: false,
    remoteEnvelopes: [],
    remoteSeen: 0,
    snapshotsApplied: 0,
    changesApplied: 0,
    signatureRejected: 0,
  }
}

function compareSnapshots(a: Note | null, b: Note | null): number {
  if (a && !b) return 1
  if (!a && b) return -1
  if (!a || !b) return 0

  const revisionDiff = (a.revision ?? 1) - (b.revision ?? 1)
  if (revisionDiff !== 0) {
    return revisionDiff
  }

  const updatedDiff = toEpochMs(a.updatedAt) - toEpochMs(b.updatedAt)
  if (updatedDiff !== 0) {
    return updatedDiff
  }

  const createdDiff = toEpochMs(a.createdAt) - toEpochMs(b.createdAt)
  if (createdDiff !== 0) {
    return createdDiff
  }

  const deletedDiff = toEpochMs(a.deletedAt ?? null) - toEpochMs(b.deletedAt ?? null)
  if (deletedDiff !== 0) {
    return deletedDiff
  }

  return 0
}

function compareEnvelopes(a: ChangeEnvelope, b: ChangeEnvelope): number {
  const aSnapshot = asSnapshotNote(a.snapshot, a.noteId)
  const bSnapshot = asSnapshotNote(b.snapshot, b.noteId)

  const snapshotDiff = compareSnapshots(aSnapshot, bSnapshot)
  if (snapshotDiff !== 0) {
    return snapshotDiff
  }

  const tsDiff = (a.ts ?? 0) - (b.ts ?? 0)
  if (tsDiff !== 0) {
    return tsDiff
  }

  return a.changeId.localeCompare(b.changeId)
}

function selectLatestEnvelopePerNote(envelopes: ChangeEnvelope[]): Map<string, ChangeEnvelope> {
  const latestByNoteId = new Map<string, ChangeEnvelope>()
  for (const envelope of envelopes) {
    const existing = latestByNoteId.get(envelope.noteId)
    if (!existing || compareEnvelopes(envelope, existing) > 0) {
      latestByNoteId.set(envelope.noteId, envelope)
    }
  }
  return latestByNoteId
}

function shouldApplySnapshot(current: Note | null, incoming: Note): boolean {
  return compareSnapshots(incoming, current) > 0
}

async function normalizeRemoteEnvelopes(blob: SyncBlob | null): Promise<{ envelopes: ChangeEnvelope[]; seen: number; signatureRejected: number }> {
  if (!blob) {
    return { envelopes: [], seen: 0, signatureRejected: 0 }
  }

  const valid: ChangeEnvelope[] = []
  let seen = 0
  let signatureRejected = 0

  for (const rawItem of blob.changes) {
    const envelope = asSyncEnvelope(rawItem)
    if (!envelope) {
      continue
    }

    seen += 1
    if (envelope.signature) {
      try {
        const ok = await verifyTrustedEnvelope(envelope)
        if (!ok) {
          signatureRejected += 1
          continue
        }
      } catch {
        signatureRejected += 1
        continue
      }
    }

    valid.push(envelope)
  }

  return {
    envelopes: [...selectLatestEnvelopePerNote(valid).values()],
    seen,
    signatureRejected,
  }
}

async function mergeRemoteSnapshots(blob: SyncBlob | null): Promise<MergeResult> {
  const normalized = await normalizeRemoteEnvelopes(blob)
  if (normalized.envelopes.length === 0) {
    return {
      ...createEmptyMergeResult(),
      remoteSeen: normalized.seen,
      signatureRejected: normalized.signatureRejected,
    }
  }

  let snapshotsApplied = 0
  let changesApplied = 0
  for (const envelope of normalized.envelopes) {
    const snapshot = asSnapshotNote(envelope.snapshot, envelope.noteId)
    if (snapshot) {
      const current = await getNoteById(envelope.noteId)
      if (!shouldApplySnapshot(current, snapshot)) {
        continue
      }

      await upsertNote(snapshot)
      snapshotsApplied += 1
      continue
    }

    const payload = decodeChangePayload(envelope.payload)
    if (payload.length > 0) {
      await applyRemoteChanges(envelope.noteId, payload)
      changesApplied += 1
    }
  }

  return {
    applied: snapshotsApplied > 0 || changesApplied > 0,
    remoteEnvelopes: normalized.envelopes,
    remoteSeen: normalized.seen,
    snapshotsApplied,
    changesApplied,
    signatureRejected: normalized.signatureRejected,
  }
}

function mergeEnvelopeSets(remoteEnvelopes: ChangeEnvelope[], localEnvelopes: ChangeEnvelope[]): ChangeEnvelope[] {
  const merged = new Map<string, ChangeEnvelope>()

  for (const envelope of remoteEnvelopes) {
    merged.set(envelope.noteId, envelope)
  }

  for (const envelope of localEnvelopes) {
    const current = merged.get(envelope.noteId)
    if (!current || compareEnvelopes(envelope, current) > 0) {
      merged.set(envelope.noteId, envelope)
    }
  }

  return [...merged.values()].sort((a, b) => {
    const tsDiff = (a.ts ?? 0) - (b.ts ?? 0)
    if (tsDiff !== 0) {
      return tsDiff
    }
    return a.noteId.localeCompare(b.noteId)
  })
}

function collectNoteIds(envelopes: ChangeEnvelope[]): Set<string> {
  const ids = new Set<string>()
  for (const envelope of envelopes) {
    ids.add(envelope.noteId)
  }
  return ids
}

async function getPendingEnvelopes(roomId: string, limit: number): Promise<{ rows: Awaited<ReturnType<typeof listPendingOutboxChanges>>; envelopes: ChangeEnvelope[] }> {
  const rows = await listPendingOutboxChanges(roomId, limit)
  const envelopes: ChangeEnvelope[] = []

  for (const row of rows) {
    try {
      const envelope = decodeOutboxEnvelope(row.bytes)
      const parsed = asSyncEnvelope(envelope)
      if (parsed) {
        envelopes.push(parsed)
      }
    } catch {
      // Ignore malformed local entries; keeping sync resilient is more important than hard-failing here.
    }
  }

  return { rows, envelopes: [...selectLatestEnvelopePerNote(envelopes).values()] }
}

async function markPendingAsSentWhenCovered(
  pendingRows: Awaited<ReturnType<typeof listPendingOutboxChanges>>,
  roomId: string,
  syncToken: string,
): Promise<void> {
  if (pendingRows.length === 0) {
    return
  }

  const pendingByChangeId = new Map<string, ChangeEnvelope>()
  for (const row of pendingRows) {
    try {
      const envelope = decodeOutboxEnvelope(row.bytes)
      const parsed = asSyncEnvelope(envelope)
      if (parsed) {
        pendingByChangeId.set(row.changeId, parsed)
      }
    } catch {
      // ignore malformed pending entries
    }
  }

  const remoteAfterPush = await pullSync(roomId, syncToken)
  const normalizedRemote = await normalizeRemoteEnvelopes(asSyncBlob(remoteAfterPush?.blob ?? null))
  const remoteByNoteId = selectLatestEnvelopePerNote(normalizedRemote.envelopes)

  const acked: string[] = []
  for (const row of pendingRows) {
    const pending = pendingByChangeId.get(row.changeId)
    if (!pending) {
      continue
    }

    const remote = remoteByNoteId.get(pending.noteId)
    if (!remote) {
      continue
    }

    if (compareEnvelopes(remote, pending) >= 0) {
      acked.push(row.changeId)
    }
  }

  if (acked.length > 0) {
    await markOutboxChangesSent(acked)
  }
}

export function startSyncEngine(options: SyncEngineOptions = {}) {
  const roomId = options.roomId ?? DEFAULT_SYNC_ROOM_ID
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const pullIntervalMs = options.pullIntervalMs ?? DEFAULT_PULL_INTERVAL_MS
  const onStatusChange = options.onStatusChange
  const onDataChanged = options.onDataChanged
  const onDiagnostics = options.onDiagnostics

  let stopped = false
  let pushTimer: number | null = null
  let pushRunning = false
  let pullRunning = false
  let pullInterval: number | null = null

  const setStatus = (status: SyncUiStatus, error?: string | null) => {
    onStatusChange?.(status, error ?? null)
  }

  const clearPushTimer = () => {
    if (pushTimer !== null) {
      window.clearTimeout(pushTimer)
      pushTimer = null
    }
  }

  const schedulePush = () => {
    if (stopped) {
      return
    }
    clearPushTimer()
    pushTimer = window.setTimeout(() => {
      void pushNow()
    }, debounceMs)
  }

  const pullOnce = async (): Promise<MergeResult> => {
    const syncState = await getSyncState(roomId)
    if (!syncState.isEnabled) {
      setStatus('disabled')
      return createEmptyMergeResult()
    }
    if (!syncState.syncToken) {
      await updateSyncState(roomId, { lastError: 'Sync-Token fehlt. Bitte Sync neu aktivieren.' })
      setStatus('error', 'Sync-Token fehlt. Bitte Sync neu aktivieren.')
      return createEmptyMergeResult()
    }

    const remoteState = await pullSync(roomId, syncState.syncToken)
    const merged = await mergeRemoteSnapshots(asSyncBlob(remoteState?.blob ?? null))

    await updateSyncState(roomId, {
      lastPulledSeq: syncState.lastPulledSeq + merged.snapshotsApplied,
      lastError: null,
    })
    if (merged.applied) {
      onDataChanged?.()
    }
    return merged
  }

  const pushNow = async () => {
    if (stopped || pushRunning) return
    pushRunning = true
    try {
      await syncNow({ roomId, onStatusChange, onDataChanged, onDiagnostics })
    } finally {
      pushRunning = false
    }
  }

  const pullNow = async () => {
    if (stopped || pullRunning) {
      return
    }
    if (!isOnline()) {
      setStatus('offline')
      return
    }

    pullRunning = true
    setStatus('syncing')
    try {
      const merged = await pullOnce()
      onDiagnostics?.({
        atISO: new Date().toISOString(),
        mode: 'pull',
        remoteEnvelopesSeen: merged.remoteSeen,
        remoteEnvelopesApplied: merged.remoteEnvelopes.length,
        snapshotApplied: merged.snapshotsApplied,
        changeApplied: merged.changesApplied,
        snapshotRescues: 0,
        signatureRejected: merged.signatureRejected,
        remoteChangedRetries: 0,
        pendingOutboxCount: 0,
      })
      setStatus('idle')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pull failed'
      await updateSyncState(roomId, { lastError: message })
      setStatus('error', message)
    } finally {
      pullRunning = false
    }
  }

  const onLocalChange = () => {
    schedulePush()
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      void pullNow()
      schedulePush()
    }
  }

  const onOnline = () => {
    setStatus('idle')
    void pullNow()
    schedulePush()
  }

  const onOffline = () => {
    setStatus('offline')
  }

  window.addEventListener('leiser:local-change', onLocalChange as EventListener)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  pullInterval = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void pullNow()
    }
  }, pullIntervalMs)

  void (async () => {
    const state = await getSyncState(roomId)
    setStatus(state.isEnabled ? (isOnline() ? 'idle' : 'offline') : 'disabled')
    if (state.isEnabled && isOnline()) {
      void pullNow()
      schedulePush()
    }
  })()

  return () => {
    stopped = true
    clearPushTimer()
    if (pullInterval !== null) {
      window.clearInterval(pullInterval)
      pullInterval = null
    }
    window.removeEventListener('leiser:local-change', onLocalChange as EventListener)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}

export async function syncNow(options: SyncNowOptions = {}) {
  const roomId = options.roomId ?? DEFAULT_SYNC_ROOM_ID
  const setStatus = (status: SyncUiStatus, error?: string | null) => {
    options.onStatusChange?.(status, error ?? null)
  }

  if (!isOnline()) {
    setStatus('offline')
    return
  }

  setStatus('syncing')
  try {
    const syncState = await getSyncState(roomId)
    if (!syncState.isEnabled) {
      setStatus('disabled')
      return
    }
    if (!syncState.syncToken) {
      await updateSyncState(roomId, { lastError: 'Sync-Token fehlt. Bitte Sync neu aktivieren.' })
      setStatus('error', 'Sync-Token fehlt. Bitte Sync neu aktivieren.')
      return
    }

    const maxRetries = 2
    const outboxBatchLimit = 300
    const maxOutboxDrainRounds = 10

    let totalRemoteSeen = 0
    let totalRemoteApplied = 0
    let totalSnapshotsApplied = 0
    let totalChangesApplied = 0
    let totalSignatureRejected = 0
    let remoteChangedRetries = 0
    let pendingOutboxCount = 0
    let appliedAny = false
    let bootstrappedSnapshots = false

    let hasMorePending = true
    let drainRounds = 0

    while (hasMorePending && drainRounds < maxOutboxDrainRounds) {
      drainRounds += 1
      let attempts = 0
      let synced = false
      let lastPendingRows: Awaited<ReturnType<typeof listPendingOutboxChanges>> = []

      while (!synced && attempts <= maxRetries) {
        attempts += 1

        const remoteState = await pullSync(roomId, syncState.syncToken)
        const remoteVersion = remoteState?.version ?? 0
        const merged = await mergeRemoteSnapshots(asSyncBlob(remoteState?.blob ?? null))

        totalRemoteSeen += merged.remoteSeen
        totalRemoteApplied += merged.remoteEnvelopes.length
        totalSnapshotsApplied += merged.snapshotsApplied
        totalChangesApplied += merged.changesApplied
        totalSignatureRejected += merged.signatureRejected
        appliedAny = appliedAny || merged.applied

        let pending = await getPendingEnvelopes(roomId, outboxBatchLimit)
        lastPendingRows = pending.rows
        pendingOutboxCount = pending.rows.length

        if (!bootstrappedSnapshots) {
          const existingIds = collectNoteIds(merged.remoteEnvelopes)
          for (const envelope of pending.envelopes) {
            existingIds.add(envelope.noteId)
          }
          const seeded = await enqueueMissingRoomSnapshots(roomId, existingIds)
          bootstrappedSnapshots = true
          if (seeded > 0) {
            setStatus('syncing', `${seeded} Bestandsdaten werden synchronisiert…`)
            pending = await getPendingEnvelopes(roomId, outboxBatchLimit)
            lastPendingRows = pending.rows
            pendingOutboxCount = pending.rows.length
          }
        }

        const combined = mergeEnvelopeSets(merged.remoteEnvelopes, pending.envelopes)
        if (combined.length === 0) {
          synced = true
          break
        }

        const blob: SyncBlob = {
          version: 1,
          changes: combined,
        }

        try {
          await pushSync(roomId, syncState.syncToken, blob, remoteVersion)
          await markPendingAsSentWhenCovered(lastPendingRows, roomId, syncState.syncToken)
          synced = true
        } catch (error) {
          if (error instanceof Error && error.message === REMOTE_CHANGED_ERROR && attempts <= maxRetries) {
            remoteChangedRetries += 1
            setStatus('syncing', 'Remote geändert, synchronisiere erneut…')
            continue
          }
          throw error
        }
      }

      const remainingPending = await listPendingOutboxChanges(roomId, 1)
      hasMorePending = remainingPending.length > 0
      if (hasMorePending) {
        setStatus('syncing', 'Sende weitere lokale Änderungen…')
      }
    }

    await updateSyncState(roomId, {
      lastPulledSeq: syncState.lastPulledSeq + totalSnapshotsApplied,
      lastPushedAt: new Date().toISOString(),
      lastError: null,
    })
    if (appliedAny) {
      options.onDataChanged?.()
    }
    options.onDiagnostics?.({
      atISO: new Date().toISOString(),
      mode: 'push',
      remoteEnvelopesSeen: totalRemoteSeen,
      remoteEnvelopesApplied: totalRemoteApplied,
      snapshotApplied: totalSnapshotsApplied,
      changeApplied: totalChangesApplied,
      snapshotRescues: 0,
      signatureRejected: totalSignatureRejected,
      remoteChangedRetries,
      pendingOutboxCount,
    })
    setStatus('idle')
  } catch (error) {
    const message = errorMessage(error, 'Sync failed')
    const pending = await listPendingOutboxChanges(roomId, 50)
    if (pending[0]) {
      await bumpOutboxAttempt(pending[0].changeId)
    }
    await updateSyncState(roomId, { lastError: message })
    setStatus(isOnline() ? 'error' : 'offline', message)
    throw error
  }
}

export type { SyncUiStatus, SyncDiagnostics }
