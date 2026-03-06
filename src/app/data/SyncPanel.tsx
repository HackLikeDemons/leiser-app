import type { ChangeEvent } from 'react'
import type { ImportMode, ImportReport } from '../../lib/backup'
import { getSyncRoomAlias } from '../../lib/syncRoomAlias'
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
  onExportActive: () => void
  onToggleImportPanel: () => void
  showImportPanel: boolean
  onImportFileChange: (file: File | null) => void
  importMode: ImportMode
  onImportModeChange: (mode: ImportMode) => void
  onImport: () => void
  onToggleSyncEnabled: () => void
  onCreateSyncRoom: () => void
  onRekeySyncCluster: () => void
  onWipeClient: () => void
  syncEnabled: boolean
  onToggleDebugInfo: () => void
  showDebugInfo: boolean
  onSyncNow: () => void
  onCopySyncProtocol: () => void
  syncNowBusy: boolean
  lastBackupAtLabel: string
  backupOverdue: boolean
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
  onExportActive,
  onToggleImportPanel,
  showImportPanel,
  onImportFileChange,
  importMode,
  onImportModeChange,
  onImport,
  onToggleSyncEnabled,
  onCreateSyncRoom,
  onRekeySyncCluster,
  onWipeClient,
  syncEnabled,
  onToggleDebugInfo,
  showDebugInfo,
  onSyncNow,
  onCopySyncProtocol,
  syncNowBusy,
  lastBackupAtLabel,
  backupOverdue,
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
  const roomAlias = devSyncInfo ? getSyncRoomAlias(devSyncInfo.roomId) : null

  return (
    <>
      <section className="data-card" aria-label="Backup">
        <h3>Backup</h3>
        <div className="data-actions">
          <button type="button" onClick={onExport}>
            Backup exportieren
          </button>
          <button type="button" onClick={onExportActive}>
            Aktive Einträge exportieren
          </button>
          <button type="button" onClick={onToggleImportPanel}>
            {showImportPanel ? 'Import schließen' : 'Backup importieren'}
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
          <p className="hint">Letztes Backup: {lastBackupAtLabel}</p>
          {backupOverdue ? (
            <div className="backup-reminder">
              <p className="hint">Backup überfällig. Sichere jetzt kurz deine Daten.</p>
              <button type="button" onClick={onExport}>
                Jetzt sichern
              </button>
            </div>
          ) : null}
          {importReport ? (
            <p className="hint">
              Importiert: {importReport.imported} · Aktualisiert: {importReport.updated} · Übersprungen:{' '}
              {importReport.skipped} · Ungültig: {importReport.invalid}
            </p>
          ) : null}
          {info ? <p className="hint">{info}</p> : null}
          {offlineReady ? <p className="hint">Offline bereit.</p> : null}
        </div>
      </section>

      <section className="data-card" aria-label="Sync">
        <h3>Sync</h3>
        <div className="sync-primary-actions">
          <button type="button" onClick={onToggleSyncEnabled}>
            {syncEnabled ? 'Sync deaktivieren' : 'Sync aktivieren'}
          </button>
          <button type="button" onClick={onSyncNow} disabled={!syncEnabled || syncNowBusy}>
            {syncNowBusy ? 'Sync läuft…' : 'Sync now (Debug)'}
          </button>
        </div>
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

        <div className="danger-zone" role="group" aria-label="Gefährliche Aktionen">
          <p className="danger-zone__warning">
            Vorsicht: Diese Aktionen können den Zugriff auf bestehende Sync-Daten auf diesem Gerät unterbrechen oder löschen.
          </p>
          <div className="danger-zone__actions">
            {!syncEnabled ? (
              <div className="danger-zone__item">
                <button type="button" className="danger-btn" onClick={onCreateSyncRoom}>
                  Neuen Sync-Raum erstellen
                </button>
                <p className="danger-zone__hint">Startet einen neuen, leeren Verbund für dieses Gerät.</p>
              </div>
            ) : null}
            {syncEnabled ? (
              <div className="danger-zone__item">
                <button type="button" className="danger-btn" onClick={onRekeySyncCluster}>
                  Client aus Verbund entfernen
                </button>
                <p className="danger-zone__hint">Erstellt neuen Pair-Code und sperrt andere Geräte für künftigen Sync aus. Daten bleiben auf diesem Client erhalten.</p>
              </div>
            ) : null}
            <div className="danger-zone__item">
              <button type="button" className="danger-btn danger-btn--critical" onClick={onWipeClient}>
                Client bereinigen
              </button>
              <p className="danger-zone__hint">Löscht alle lokalen Daten auf diesem Gerät und trennt die Kopplung.</p>
            </div>
          </div>
        </div>

        <div className="data-status">
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
          {showDebugInfo && roomAlias ? <p className="hint">Raumname: {roomAlias}</p> : null}
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
            <p className="hint">Room Alias: {roomAlias}</p>
            <p className="hint">Last Pulled Seq: {devSyncInfo.lastPulledSeq}</p>
            <p className="hint">Sync enabled: {String(devSyncInfo.isEnabled)}</p>
            <p className="hint">Sync token: {devSyncInfo.syncToken ? 'gesetzt' : 'nicht gesetzt'}</p>
          </div>
        ) : null}
      </section>
    </>
  )
}
