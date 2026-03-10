import { getSyncRoomAlias } from '../../lib/syncRoomAlias'
import type { SyncDiagnostics, SyncUiStatus } from '../../lib/syncEngine'
import type { DevSyncInfo } from './SyncPanel'

type SupabaseConfigStatus = {
  configured: boolean
  source: 'runtime' | 'vite' | 'none'
  sourceLabel: string
}

type DebugPanelProps = {
  onToggleDebugInfo: () => void
  showDebugInfo: boolean
  onCopySyncProtocol: () => void
  syncStatus: SyncUiStatus
  syncError: string | null
  supabaseConfigStatus: SupabaseConfigStatus
  devSyncInfo: DevSyncInfo | null
  syncDiagnostics: SyncDiagnostics | null
  formatSyncTimeLabel: (isoTimestamp: string | null) => string
}

export function DebugPanel({
  onToggleDebugInfo,
  showDebugInfo,
  onCopySyncProtocol,
  syncStatus,
  syncError,
  supabaseConfigStatus,
  devSyncInfo,
  syncDiagnostics,
  formatSyncTimeLabel,
}: DebugPanelProps) {
  const roomAlias = devSyncInfo ? getSyncRoomAlias(devSyncInfo.roomId) : null

  return (
    <section className="data-card" aria-label="Debug Infos">
      <h3>Debug</h3>
      <p className="hint data-card__intro">Nur bei Bedarf öffnen. Dieser Bereich zeigt technische Sync-Details.</p>
      <div className="data-actions sync-secondary-actions">
        <button type="button" onClick={onToggleDebugInfo}>
          {showDebugInfo ? 'Debug-Infos ausblenden' : 'Debug-Infos anzeigen'}
        </button>
        {showDebugInfo ? (
          <button type="button" onClick={onCopySyncProtocol}>
            Sync-Protokoll kopieren
          </button>
        ) : null}
      </div>

      {showDebugInfo ? (
        <>
          <div className="data-status">
            {syncStatus === 'syncing' ? <p className="hint">{syncError ?? 'Sync läuft im Hintergrund.'}</p> : null}
            {syncStatus === 'offline' ? <p className="hint">Sync pausiert (offline).</p> : null}
            {syncStatus === 'error' && syncError ? <p className="error-text">{syncError}</p> : null}
            <p className="hint">
              Supabase-Konfiguration: {supabaseConfigStatus.sourceLabel}
            </p>
            {roomAlias ? <p className="hint">Syncraum: {roomAlias}</p> : null}
            <p className="hint">Letzter Sync: {formatSyncTimeLabel(devSyncInfo?.lastPushedAt ?? null)}</p>
          </div>

          {syncDiagnostics ? (
            <div className="dev-sync-panel">
              <p className="hint">
                Sync Diagnose ({syncDiagnostics.mode}) · {formatSyncTimeLabel(syncDiagnostics.atISO)}
              </p>
              <p className="hint">
                Remote gesehen: {syncDiagnostics.remoteEnvelopesSeen} · angewendet: {syncDiagnostics.remoteEnvelopesApplied}
              </p>
              <p className="hint">
                Snapshot: {syncDiagnostics.snapshotApplied} · Changes: {syncDiagnostics.changeApplied} · Snapshot-Rescue:{' '}
                {syncDiagnostics.snapshotRescues}
              </p>
              <p className="hint">
                Retry (remote changed): {syncDiagnostics.remoteChangedRetries} · Pending Outbox:{' '}
                {syncDiagnostics.pendingOutboxCount}
              </p>
            </div>
          ) : null}

          {import.meta.env.DEV && devSyncInfo ? (
            <div className="dev-sync-panel">
              <p className="hint">Device ID: {devSyncInfo.deviceId}</p>
              <p className="hint">Room ID: {devSyncInfo.roomId}</p>
              <p className="hint">Room Alias: {roomAlias}</p>
              <p className="hint">Last Pulled Seq: {devSyncInfo.lastPulledSeq}</p>
              <p className="hint">Sync enabled: {String(devSyncInfo.isEnabled)}</p>
              <p className="hint">Sync token: {devSyncInfo.syncToken ? 'gesetzt' : 'nicht gesetzt'}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
