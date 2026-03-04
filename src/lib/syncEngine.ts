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
  updateSyncState,
} from './dbNotes'
import { pullSync, pushSync, REMOTE_CHANGED_ERROR, type SyncBlob } from './sync/supabaseAdapter'
import { verifyTrustedEnvelope } from './syncSigning'
import type { ChangeEnvelope } from './types'

type SyncUiStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled'

type SyncEngineOptions = {
  roomId?: string
  debounceMs?: number
  pullIntervalMs?: number
  onStatusChange?: (status: SyncUiStatus, error?: string | null) => void
  onDataChanged?: () => void
}

type SyncNowOptions = {
  roomId?: string
  onStatusChange?: (status: SyncUiStatus, error?: string | null) => void
  onDataChanged?: () => void
}

const DEFAULT_DEBOUNCE_MS = 1200
const DEFAULT_PULL_INTERVAL_MS = 90000

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
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
      return { applied: false, seen: 0, remoteEnvelopes: [] as ChangeEnvelope[] }
    }

    const seenKeys: string[] = []
    const remoteEnvelopes: ChangeEnvelope[] = []
    let applied = false

    for (const rawItem of blob.changes) {
      const item = asSyncEnvelope(rawItem)
      if (!item) {
        continue
      }
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

      const bytes = decodeChangePayload(item.payload)
      await applyRemoteChanges(item.noteId, bytes)
      seenKeys.push(dedupeKey)
      remoteEnvelopes.push(item)
      applied = true
    }

    if (seenKeys.length > 0) {
      await markInboxSeen(seenKeys, 30 * 24 * 60 * 60 * 1000)
    }

    return { applied, seen: seenKeys.length, remoteEnvelopes }
  }

  const pullOnce = async () => {
    const syncState = await getSyncState(roomId)
    if (!syncState.isEnabled) {
      setStatus('disabled')
      return { applied: false, seen: 0, remoteEnvelopes: [] as ChangeEnvelope[] }
    }
    if (!syncState.syncToken) {
      await updateSyncState(roomId, { lastError: 'Sync-Token fehlt. Bitte Sync neu aktivieren.' })
      setStatus('error', 'Sync-Token fehlt. Bitte Sync neu aktivieren.')
      return { applied: false, seen: 0, remoteEnvelopes: [] as ChangeEnvelope[] }
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
      await syncNow({ roomId, onStatusChange, onDataChanged })
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
      await pullOnce()
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

    while (!synced && attempts <= maxRetries) {
      attempts += 1

      const remoteState = await pullSync(roomId, syncState.syncToken)
      const remoteVersion = remoteState?.version ?? 0
      const remoteBlob = asSyncBlob(remoteState?.blob ?? null)
      const merged = await (async () => {
        const seenKeys: string[] = []
        const remoteEnvelopes: ChangeEnvelope[] = []
        let applied = false

        for (const rawItem of remoteBlob?.changes ?? []) {
          const item = asSyncEnvelope(rawItem)
          if (!item) continue
          const dedupeKey = `${roomId}:${item.changeId}`
          if (await hasInboxSeen(dedupeKey)) {
            remoteEnvelopes.push(item)
            continue
          }
          if (item.signature) {
            const signatureValid = await verifyTrustedEnvelope(item)
            if (!signatureValid) continue
          }
          const bytes = decodeChangePayload(item.payload)
          await applyRemoteChanges(item.noteId, bytes)
          seenKeys.push(dedupeKey)
          remoteEnvelopes.push(item)
          applied = true
        }

        if (seenKeys.length > 0) {
          await markInboxSeen(seenKeys, 30 * 24 * 60 * 60 * 1000)
        }
        return { applied, seen: seenKeys.length, remoteEnvelopes }
      })()

      totalSeen += merged.seen
      appliedAny = appliedAny || merged.applied

      const pending = await listPendingOutboxChanges(roomId, 200)
      const localEnvelopes = pending.map((row) => decodeOutboxEnvelope(row.bytes))
      pendingForAck = pending.map((row) => row.changeId)

      const combined = new Map<string, ChangeEnvelope>()
      for (const env of merged.remoteEnvelopes) combined.set(env.changeId, env)
      for (const env of localEnvelopes) combined.set(env.changeId, env)

      if (combined.size === 0) {
        synced = true
        break
      }

      const blob: SyncBlob = {
        version: 1,
        changes: [...combined.values()].sort((a, b) => a.ts - b.ts),
      }

      try {
        await pushSync(roomId, syncState.syncToken, blob, remoteVersion)
        synced = true
      } catch (error) {
        if (error instanceof Error && error.message === REMOTE_CHANGED_ERROR && attempts <= maxRetries) {
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
    setStatus('idle')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed'
    const pending = await listPendingOutboxChanges(roomId, 50)
    if (pending[0]) {
      await bumpOutboxAttempt(pending[0].changeId)
    }
    await updateSyncState(roomId, { lastError: message })
    setStatus(isOnline() ? 'error' : 'offline', message)
    throw error
  }
}

export type { SyncUiStatus }
