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
import { isSyncSigningSupported, verifyTrustedEnvelope } from './syncSigning'
import type { ChangeEnvelope } from './types'

type SyncUiStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled'

type SyncEngineOptions = {
  roomId?: string
  debounceMs?: number
  pullIntervalMs?: number
  onStatusChange?: (status: SyncUiStatus, error?: string | null) => void
  onDataChanged?: () => void
}

type PullResponse = {
  seq?: number
  changes?: Array<Partial<ChangeEnvelope>>
}

type PushResponse = {
  ackedChangeIds?: string[]
}

const SYNC_ENDPOINT_KEY = 'leiser:syncEndpoint'
const DEFAULT_DEBOUNCE_MS = 1200
const DEFAULT_PULL_INTERVAL_MS = 90000

function getSyncEndpoint(): string | null {
  const raw = localStorage.getItem(SYNC_ENDPOINT_KEY)?.trim() ?? ''
  if (!raw) {
    return null
  }
  return raw.replace(/\/+$/, '')
}

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
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

  const pushNow = async () => {
    if (stopped || pushRunning) {
      return
    }

    const endpoint = getSyncEndpoint()
    const syncState = await getSyncState(roomId)
    if (!syncState.isEnabled || !endpoint) {
      setStatus(syncState.isEnabled ? 'idle' : 'disabled')
      return
    }
    if (!isOnline()) {
      setStatus('offline')
      return
    }

    pushRunning = true
    setStatus('syncing')
    try {
      const pending = await listPendingOutboxChanges(roomId, 50)
      if (pending.length === 0) {
        await updateSyncState(roomId, { lastError: null })
        setStatus('idle')
        return
      }

      const envelopes = pending.map((row) => decodeOutboxEnvelope(row.bytes))
      const response = await fetch(`${endpoint}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, changes: envelopes }),
      })
      if (!response.ok) {
        throw new Error(`Push failed (${response.status})`)
      }

      const json = (await response.json().catch(() => ({}))) as PushResponse
      const ackedIds = json.ackedChangeIds?.length
        ? json.ackedChangeIds
        : pending.map((row) => row.changeId)
      await markOutboxChangesSent(ackedIds)
      await updateSyncState(roomId, {
        lastPushedAt: new Date().toISOString(),
        lastError: null,
      })
      setStatus('idle')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Push failed'
      const pending = await listPendingOutboxChanges(roomId, 50)
      if (pending[0]) {
        await bumpOutboxAttempt(pending[0].changeId)
      }
      await updateSyncState(roomId, { lastError: message })
      setStatus(isOnline() ? 'error' : 'offline', message)
    } finally {
      pushRunning = false
    }
  }

  const pullNow = async () => {
    if (stopped || pullRunning) {
      return
    }

    const endpoint = getSyncEndpoint()
    const syncState = await getSyncState(roomId)
    if (!syncState.isEnabled || !endpoint) {
      setStatus(syncState.isEnabled ? 'idle' : 'disabled')
      return
    }
    if (!isOnline()) {
      setStatus('offline')
      return
    }

    pullRunning = true
    setStatus('syncing')
    try {
      const response = await fetch(
        `${endpoint}/pull?roomId=${encodeURIComponent(roomId)}&sinceSeq=${encodeURIComponent(String(syncState.lastPulledSeq))}`,
      )
      if (!response.ok) {
        throw new Error(`Pull failed (${response.status})`)
      }

      const json = (await response.json().catch(() => ({}))) as PullResponse
      const seq = typeof json.seq === 'number' ? json.seq : syncState.lastPulledSeq
      const changes = Array.isArray(json.changes) ? json.changes : []
      const seenKeys: string[] = []
      let applied = false

      for (const item of changes) {
        const noteId = item.noteId
        const changeId = item.changeId
        const payload = item.payload
        if (!noteId || !Array.isArray(payload) || !changeId) {
          continue
        }
        const signatureValid = await verifyTrustedEnvelope(item as ChangeEnvelope)
        if (!signatureValid) {
          continue
        }
        const dedupeKey = `${roomId}:${changeId}`
        if (await hasInboxSeen(dedupeKey)) {
          continue
        }
        const bytes = decodeChangePayload(payload)
        await applyRemoteChanges(noteId, bytes)
        seenKeys.push(dedupeKey)
        applied = true
      }

      if (seenKeys.length > 0) {
        await markInboxSeen(seenKeys, 30 * 24 * 60 * 60 * 1000)
      }

      await updateSyncState(roomId, {
        lastPulledSeq: Math.max(syncState.lastPulledSeq, seq),
        lastError: null,
      })
      if (applied) {
        onDataChanged?.()
      }
      setStatus('idle')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pull failed'
      await updateSyncState(roomId, { lastError: message })
      setStatus(isOnline() ? 'error' : 'offline', message)
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
    if (state.isEnabled && !isSyncSigningSupported()) {
      await updateSyncState(roomId, {
        lastError: 'Sync-Signaturen (Ed25519) werden auf diesem Gerät nicht unterstützt.',
      })
      setStatus('error', 'Sync-Signaturen (Ed25519) werden auf diesem Gerät nicht unterstützt.')
      return
    }
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

export type { SyncUiStatus }
