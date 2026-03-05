import type { ChangeEvent } from 'react'
import type { ImportMode, ImportReport } from '../../lib/backup'
import type { SyncDiagnostics, SyncUiStatus } from '../../lib/syncEngine'

export type DevSyncInfo = {
  deviceId: string
  roomId: string
  lastPulledSeq: number
  lastPushedAt: string | null
  isEnabled: boolean
  syncToken: string | null
}

type SupabaseConfigStatus = {
  configured: boolean
  source: 'runtime' | 'vite' | 'none'
}

type SyncPanelProps = {
  onExport: () => void
  onToggleImportPanel: () => void
  showImportPanel: boolean
  onImportFileChange: (file: File | null) => void
  importMode: ImportMode
  onImportModeChange: (mode: ImportMode) => void
  onImport: () => void
  onToggleSyncEnabled: () => void
  syncEnabled: boolean
  onToggleDebugInfo: () => void
  showDebugInfo: boolean
  onSyncNow: () => void
  syncNowBusy: boolean
  importReport: ImportReport | null
  info: string
  offlineReady: boolean
  syncStatus: SyncUiStatus
  syncError: string | null
  supabaseConfigStatus: SupabaseConfigStatus
  devSyncInfo: DevSyncInfo | null
  syncDiagnostics: SyncDiagnostics | null
  formatSyncTimeLabel: (isoTimestamp: string | null) => string
}

export function SyncPanel({
  onExport,
  onToggleImportPanel,
  showImportPanel,
  onImportFileChange,
  importMode,
  onImportModeChange,
  onImport,
  onToggleSyncEnabled,
  syncEnabled,
  onToggleDebugInfo,
  showDebugInfo,
  onSyncNow,
  syncNowBusy,
  importReport,
  info,
  offlineReady,
  syncStatus,
  syncError,
  supabaseConfigStatus,
  devSyncInfo,
  syncDiagnostics,
  formatSyncTimeLabel,
}: SyncPanelProps) {
  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    onImportFileChange(event.target.files?.[0] ?? null)
  }

  return (
    <section className="data-card" aria-label="Backup und Sync">
      <h3>Backup und Sync</h3>
      <div className="data-actions">
        <button type="button" onClick={onExport}>
          Backup exportieren
        </button>
        <button type="button" onClick={onToggleImportPanel}>
          {showImportPanel ? 'Import schließen' : 'Backup importieren'}
        </button>
        <button type="button" onClick={onToggleSyncEnabled}>
          {syncEnabled ? 'Sync deaktivieren' : 'Sync aktivieren'}
        </button>
        <button type="button" onClick={onToggleDebugInfo}>
          {showDebugInfo ? 'Debug-Infos ausblenden' : 'Debug-Infos anzeigen'}
        </button>
        <button type="button" onClick={onSyncNow} disabled={!syncEnabled || syncNowBusy}>
          {syncNowBusy ? 'Sync läuft…' : 'Sync now (Debug)'}
        </button>
      </div>

      {showImportPanel ? (
        <div className="import-panel">
          <input type="file" accept="application/json,.json" onChange={handleImportFile} />
          <label className="import-mode-option">
            <input
              type="radio"
              name="importMode"
              checked={importMode === 'MERGE'}
              onChange={() => onImportModeChange('MERGE')}
            />
            <span>Zusammenführen (empfohlen)</span>
          </label>
          <label className="import-mode-option">
            <input
              type="radio"
              name="importMode"
              checked={importMode === 'REPLACE'}
              onChange={() => onImportModeChange('REPLACE')}
            />
            <span>Ersetzen (löscht lokale Daten)</span>
          </label>
          <button type="button" onClick={onImport}>
            Import starten
          </button>
        </div>
      ) : null}

      <div className="data-status">
        {importReport ? (
          <p className="hint">
            Importiert: {importReport.imported} · Aktualisiert: {importReport.updated} · Übersprungen:{' '}
            {importReport.skipped} · Ungültig: {importReport.invalid}
          </p>
        ) : null}
        {info ? <p className="hint">{info}</p> : null}
        {offlineReady ? <p className="hint">Offline bereit.</p> : null}
        {showDebugInfo && syncStatus === 'syncing' ? <p className="hint">{syncError ?? 'Sync läuft im Hintergrund.'}</p> : null}
        {syncStatus === 'offline' ? <p className="hint">Sync pausiert (offline).</p> : null}
        {syncStatus === 'error' && syncError ? <p className="error-text">{syncError}</p> : null}
        {showDebugInfo ? (
          <p className="hint">
            Supabase-Konfiguration:{' '}
            {supabaseConfigStatus.configured
              ? supabaseConfigStatus.source === 'runtime'
                ? 'geladen (runtime.json)'
                : 'geladen (VITE)'
              : 'fehlt'}
          </p>
        ) : null}
        {showDebugInfo ? <p className="hint">Letzter Sync: {formatSyncTimeLabel(devSyncInfo?.lastPushedAt ?? null)}</p> : null}
      </div>

      {showDebugInfo && syncDiagnostics ? (
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

      {showDebugInfo && import.meta.env.DEV && devSyncInfo ? (
        <div className="dev-sync-panel">
          <p className="hint">Device ID: {devSyncInfo.deviceId}</p>
          <p className="hint">Room ID: {devSyncInfo.roomId}</p>
          <p className="hint">Last Pulled Seq: {devSyncInfo.lastPulledSeq}</p>
          <p className="hint">Sync enabled: {String(devSyncInfo.isEnabled)}</p>
          <p className="hint">Sync token: {devSyncInfo.syncToken ? 'gesetzt' : 'nicht gesetzt'}</p>
        </div>
      ) : null}
    </section>
  )
}
