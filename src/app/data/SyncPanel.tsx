import type { SyncUiStatus } from '../../lib/syncEngine'

export type DevSyncInfo = {
  deviceId: string
  roomId: string
  lastPulledSeq: number
  lastPushedAt: string | null
  isEnabled: boolean
  syncToken: string | null
}

type SyncPanelProps = {
  onToggleSyncEnabled: () => void
  onCreateSyncRoom: () => void
  onRekeySyncCluster: () => void
  onWipeClient: () => void
  syncEnabled: boolean
  hasConfiguredSyncRoom: boolean
  onSyncNow: () => void
  syncNowBusy: boolean
  syncStatus: SyncUiStatus
  syncError: string | null
}

export function SyncPanel({
  onToggleSyncEnabled,
  onCreateSyncRoom,
  onRekeySyncCluster,
  onWipeClient,
  syncEnabled,
  hasConfiguredSyncRoom,
  onSyncNow,
  syncNowBusy,
  syncStatus,
  syncError,
}: SyncPanelProps) {
  const canShowSyncRuntimeStatus = hasConfiguredSyncRoom && syncEnabled
  const showSyncHint = canShowSyncRuntimeStatus && syncStatus === 'syncing'

  return (
    <section className="data-card" aria-label="Sync">
      <h3>Sync</h3>
      <p className="hint data-card__intro">Aktiviere Sync, um deine Daten zwischen deinen Geräten abzugleichen.</p>
      {!hasConfiguredSyncRoom ? (
        <p className="hint">Richte zuerst einen Sync-Raum ein (z. B. „Neuen Sync-Raum erstellen“ oder Pairing importieren).</p>
      ) : null}
      <div className="sync-primary-actions">
        <button type="button" onClick={onToggleSyncEnabled} disabled={!hasConfiguredSyncRoom && !syncEnabled}>
          {syncEnabled ? 'Sync deaktivieren' : 'Sync aktivieren'}
        </button>
        <button type="button" onClick={onSyncNow} disabled={!hasConfiguredSyncRoom || !syncEnabled || syncNowBusy}>
          {syncNowBusy ? 'Sync läuft…' : 'Jetzt syncen'}
        </button>
      </div>
      {!syncEnabled ? (
        <div className="sync-setup-actions">
          <button type="button" onClick={onCreateSyncRoom}>
            Neuen Sync-Raum erstellen
          </button>
          <p className="hint">Startet einen neuen, leeren Verbund für dieses Gerät.</p>
        </div>
      ) : null}

      <div className="danger-zone" role="group" aria-label="Gefährliche Aktionen">
        <p className="danger-zone__warning">
          Vorsicht: Diese Aktionen können den Zugriff auf bestehende Sync-Daten auf diesem Gerät unterbrechen oder löschen.
        </p>
        <div className="danger-zone__actions">
          {syncEnabled ? (
            <div className="danger-zone__item">
              <button type="button" className="danger-btn" onClick={onRekeySyncCluster}>
                Client aus Verbund entfernen
              </button>
              <p className="danger-zone__hint">Trennt dieses Gerät vom Verbund und wechselt in den lokalen Modus. Vorhandene lokale Daten bleiben erhalten.</p>
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
        <div className="sync-status-slot" aria-live="polite" role="status">
          {showSyncHint ? <p className="hint sync-status-slot__text">Sync läuft im Hintergrund.</p> : null}
          {canShowSyncRuntimeStatus && syncStatus === 'offline' ? (
            <p className="hint sync-status-slot__text">Sync pausiert (offline).</p>
          ) : null}
          {canShowSyncRuntimeStatus && syncStatus === 'error' && syncError ? (
            <p className="error-text sync-status-slot__text">{syncError}</p>
          ) : null}
          {!showSyncHint && (!canShowSyncRuntimeStatus || syncStatus !== 'offline') && !(canShowSyncRuntimeStatus && syncStatus === 'error' && syncError) ? (
            <p className="hint sync-status-slot__text sync-status-slot__text--placeholder">Status bereit.</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
