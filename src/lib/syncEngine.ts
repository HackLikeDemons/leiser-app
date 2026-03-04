import {
  DEFAULT_SYNC_ROOM_ID,
  applyRemoteChanges,
  bumpOutboxAttempt,
  decodeChangePayload,
  decodeOutboxEnvelope,
  getSyncState,
  hasInboxSeen,
  listPendingOutboxChanges,
  markInboxSeen,
  markOutboxChangesSent,
  upsertNote,
  updateSyncState,
} from './dbNotes'
import { pullSync, pushSync, REMOTE_CHANGED_ERROR, type SyncBlob } from './sync/supabaseAdapter'
import { verifyTrustedEnvelope } from './syncSigning'
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

  const mergeRemoteBlob = async (syncId: string, blob: SyncBlob | null) => {
    if (!blob) {
      return {
        applied: false,
        seen: 0,
        remoteEnvelopes: [] as ChangeEnvelope[],
        remoteSeen: 0,
        snapshotApplied: 0,
        changeApplied: 0,
        snapshotRescues: 0,
      }
    }

    const seenKeys: string[] = []
    const remoteEnvelopes: ChangeEnvelope[] = []
    let applied = false
    let remoteSeen = 0
    let snapshotApplied = 0
    let changeApplied = 0
    let snapshotRescues = 0

    for (const rawItem of blob.changes) {
      const item = asSyncEnvelope(rawItem)
      if (!item) {
        continue
      }
      remoteSeen += 1
      const dedupeKey = `${syncId}:${item.changeId}`
      if (await hasInboxSeen(dedupeKey)) {
        remoteEnvelopes.push(item)
        continue
      }

      if (item.signature) {
        const signatureValid = await verifyTrustedEnvelope(item)
        if (!signatureValid) {
          continue
        }
      }

      const snapshot = asSnapshotNote(item.snapshot, item.noteId)
      if (snapshot) {
        await upsertNote(snapshot)
        snapshotApplied += 1
      }

      const bytes = decodeChangePayload(item.payload)
      const appliedNote = await applyRemoteChanges(item.noteId, bytes)
      changeApplied += 1
      if (snapshot && appliedNote && !appliedNote.text && snapshot.text) {
        await upsertNote(snapshot)
        snapshotRescues += 1
      }
      seenKeys.push(dedupeKey)
      remoteEnvelopes.push(item)
      applied = true
    }

    if (seenKeys.length > 0) {
      await markInboxSeen(seenKeys, 30 * 24 * 60 * 60 * 1000)
    }

    return { applied, seen: seenKeys.length, remoteEnvelopes, remoteSeen, snapshotApplied, changeApplied, snapshotRescues }
  }

  const pullOnce = async () => {
    const syncState = await getSyncState(roomId)
    if (!syncState.isEnabled) {
      setStatus('disabled')
      return {
        applied: false,
        seen: 0,
        remoteEnvelopes: [] as ChangeEnvelope[],
        remoteSeen: 0,
        snapshotApplied: 0,
        changeApplied: 0,
        snapshotRescues: 0,
      }
    }
    if (!syncState.syncToken) {
      await updateSyncState(roomId, { lastError: 'Sync-Token fehlt. Bitte Sync neu aktivieren.' })
      setStatus('error', 'Sync-Token fehlt. Bitte Sync neu aktivieren.')
      return {
        applied: false,
        seen: 0,
        remoteEnvelopes: [] as ChangeEnvelope[],
        remoteSeen: 0,
        snapshotApplied: 0,
        changeApplied: 0,
        snapshotRescues: 0,
      }
    }

    const remoteState = await pullSync(roomId, syncState.syncToken)
    const blob = asSyncBlob(remoteState?.blob ?? null)
    const merged = await mergeRemoteBlob(roomId, blob)

    await updateSyncState(roomId, {
      lastPulledSeq: syncState.lastPulledSeq + merged.seen,
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
        remoteEnvelopesApplied: merged.seen,
        snapshotApplied: merged.snapshotApplied,
        changeApplied: merged.changeApplied,
        snapshotRescues: merged.snapshotRescues,
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
    let attempts = 0
    let pendingForAck: string[] = []
    let synced = false
    let totalSeen = 0
    let appliedAny = false
    let totalRemoteSeen = 0
    let totalSnapshotApplied = 0
    let totalChangeApplied = 0
    let totalSnapshotRescues = 0
    let remoteChangedRetries = 0
    let pendingOutboxCount = 0

    while (!synced && attempts <= maxRetries) {
      attempts += 1

      const remoteState = await pullSync(roomId, syncState.syncToken)
      const remoteVersion = remoteState?.version ?? 0
      const remoteBlob = asSyncBlob(remoteState?.blob ?? null)
      const merged = await (async () => {
        const seenKeys: string[] = []
        const remoteEnvelopes: ChangeEnvelope[] = []
        let applied = false
        let remoteSeen = 0
        let snapshotApplied = 0
        let changeApplied = 0
        let snapshotRescues = 0

        for (const rawItem of remoteBlob?.changes ?? []) {
          const item = asSyncEnvelope(rawItem)
          if (!item) continue
          remoteSeen += 1
          const dedupeKey = `${roomId}:${item.changeId}`
          if (await hasInboxSeen(dedupeKey)) {
            remoteEnvelopes.push(item)
            continue
          }
          if (item.signature) {
            const signatureValid = await verifyTrustedEnvelope(item)
            if (!signatureValid) continue
          }

          const snapshot = asSnapshotNote(item.snapshot, item.noteId)
          if (snapshot) {
            await upsertNote(snapshot)
            snapshotApplied += 1
          }

          const bytes = decodeChangePayload(item.payload)
          const appliedNote = await applyRemoteChanges(item.noteId, bytes)
          changeApplied += 1
          if (snapshot && appliedNote && !appliedNote.text && snapshot.text) {
            await upsertNote(snapshot)
            snapshotRescues += 1
          }
          seenKeys.push(dedupeKey)
          remoteEnvelopes.push(item)
          applied = true
        }

        if (seenKeys.length > 0) {
          await markInboxSeen(seenKeys, 30 * 24 * 60 * 60 * 1000)
        }
        return { applied, seen: seenKeys.length, remoteEnvelopes, remoteSeen, snapshotApplied, changeApplied, snapshotRescues }
      })()

      totalSeen += merged.seen
      appliedAny = appliedAny || merged.applied
      totalRemoteSeen += merged.remoteSeen
      totalSnapshotApplied += merged.snapshotApplied
      totalChangeApplied += merged.changeApplied
      totalSnapshotRescues += merged.snapshotRescues

      const pending = await listPendingOutboxChanges(roomId, 200)
      const localEnvelopes = pending.map((row) => decodeOutboxEnvelope(row.bytes))
      pendingForAck = pending.map((row) => row.changeId)
      pendingOutboxCount = pending.length

      const combined = new Map<string, ChangeEnvelope>()
      for (const env of merged.remoteEnvelopes) combined.set(env.changeId, env)
      for (const env of localEnvelopes) combined.set(env.changeId, env)

      if (combined.size === 0) {
        synced = true
        break
      }

      const blob: SyncBlob = {
        version: 1,
        // Keep insertion order (remote order + local outbox order). Re-sorting by ts can
        // break causal order when device clocks drift and lead to partial/empty materialization.
        changes: [...combined.values()],
      }

      try {
        await pushSync(roomId, syncState.syncToken, blob, remoteVersion)
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

    if (pendingForAck.length > 0) {
      await markOutboxChangesSent(pendingForAck)
    }

    await updateSyncState(roomId, {
      lastPulledSeq: syncState.lastPulledSeq + totalSeen,
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
      remoteEnvelopesApplied: totalSeen,
      snapshotApplied: totalSnapshotApplied,
      changeApplied: totalChangeApplied,
      snapshotRescues: totalSnapshotRescues,
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
