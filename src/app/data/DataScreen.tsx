import type { RefObject } from 'react'
import type { SyncDiagnostics, SyncUiStatus } from '../../lib/syncEngine'
import { FlowHero } from '../FlowHero'
import { DebugPanel } from './DebugPanel'
import { PairingPanel } from './PairingPanel'
import { SyncPanel, type DevSyncInfo } from './SyncPanel'

type SupabaseConfigStatus = {
  configured: boolean
  source: 'runtime' | 'vite' | 'none'
}

type DataScreenProps = {
  onBackToSettings: () => void
  onToggleSyncEnabled: () => void
  onCreateSyncRoom: () => void
  onRekeySyncCluster: () => void
  onWipeClient: () => void
  syncEnabled: boolean
  hasConfiguredSyncRoom: boolean
  onToggleDebugInfo: () => void
  showDebugInfo: boolean
  onSyncNow: () => void
  onCopySyncProtocol: () => void
  syncNowBusy: boolean
  syncStatus: SyncUiStatus
  syncError: string | null
  supabaseConfigStatus: SupabaseConfigStatus
  devSyncInfo: DevSyncInfo | null
  syncDiagnostics: SyncDiagnostics | null
  formatSyncTimeLabel: (isoTimestamp: string | null) => string
  syncPairCode: string | null
  scannerHint: string | null
  syncPairCodeDraft: string
  onShowPairQr: () => void
  onOpenScanner: () => void
  onCopyPairCode: () => void
  onPairCodeDraftChange: (value: string) => void
  onPasteFromClipboard: () => void
  onImportPairCode: () => void
  showPairQr: boolean
  onClosePairQr: () => void
  qrCanvasRef: RefObject<HTMLCanvasElement | null>
  showScanner: boolean
  onCancelScanner: () => void
  scannerVideoRef: RefObject<HTMLVideoElement | null>
}

export function DataScreen({
  onBackToSettings,
  onToggleSyncEnabled,
  onCreateSyncRoom,
  onRekeySyncCluster,
  onWipeClient,
  syncEnabled,
  hasConfiguredSyncRoom,
  onToggleDebugInfo,
  showDebugInfo,
  onSyncNow,
  onCopySyncProtocol,
  syncNowBusy,
  syncStatus,
  syncError,
  supabaseConfigStatus,
  devSyncInfo,
  syncDiagnostics,
  formatSyncTimeLabel,
  syncPairCode,
  scannerHint,
  syncPairCodeDraft,
  onShowPairQr,
  onOpenScanner,
  onCopyPairCode,
  onPairCodeDraftChange,
  onPasteFromClipboard,
  onImportPairCode,
  showPairQr,
  onClosePairQr,
  qrCanvasRef,
  showScanner,
  onCancelScanner,
  scannerVideoRef,
}: DataScreenProps) {
  return (
    <section className="data-section" aria-label="Daten">
      <FlowHero
        title="Sync und Geräte koppeln"
        subtitle="Aktiviere bei Bedarf den Sync und verbinde weitere Geräte über den QR-Code."
      />
      <div className="data-panel">
        <div className="settings-subnav">
          <button
            type="button"
            className="settings-subnav__back-btn"
            onClick={onBackToSettings}
          >
            Zurück zu Einstellungen
          </button>
        </div>
        <div className="data-layout">
          <SyncPanel
            onToggleSyncEnabled={onToggleSyncEnabled}
            onCreateSyncRoom={onCreateSyncRoom}
            onRekeySyncCluster={onRekeySyncCluster}
            onWipeClient={onWipeClient}
            syncEnabled={syncEnabled}
            hasConfiguredSyncRoom={hasConfiguredSyncRoom}
            onSyncNow={onSyncNow}
            syncNowBusy={syncNowBusy}
            syncStatus={syncStatus}
            syncError={syncError}
          />
          <PairingPanel
            syncPairCode={syncPairCode}
            scannerHint={scannerHint}
            syncPairCodeDraft={syncPairCodeDraft}
            onShowPairQr={onShowPairQr}
            onOpenScanner={onOpenScanner}
            onCopyPairCode={onCopyPairCode}
            onPairCodeDraftChange={onPairCodeDraftChange}
            onPasteFromClipboard={onPasteFromClipboard}
            onImportPairCode={onImportPairCode}
          />
          <DebugPanel
            onToggleDebugInfo={onToggleDebugInfo}
            showDebugInfo={showDebugInfo}
            onCopySyncProtocol={onCopySyncProtocol}
            syncStatus={syncStatus}
            syncError={syncError}
            supabaseConfigStatus={supabaseConfigStatus}
            devSyncInfo={devSyncInfo}
            syncDiagnostics={syncDiagnostics}
            formatSyncTimeLabel={formatSyncTimeLabel}
          />
        </div>

        {showPairQr ? (
          <div className="pairing-modal-backdrop" role="presentation" onClick={onClosePairQr}>
            <div
              className="pairing-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Pairing QR-Code"
              onClick={(event) => event.stopPropagation()}
            >
              <h3>Pairing QR-Code</h3>
              <canvas ref={qrCanvasRef} width={256} height={256} />
              <p className="hint">Teile deinen Sync Code nur mit Geräten denen du vertraust.</p>
              <button type="button" onClick={onClosePairQr}>
                Schließen
              </button>
            </div>
          </div>
        ) : null}

        {showScanner ? (
          <div className="pairing-modal-backdrop" role="presentation" onClick={onCancelScanner}>
            <div
              className="pairing-modal pairing-modal--scanner"
              role="dialog"
              aria-modal="true"
              aria-label="QR Scanner"
              onClick={(event) => event.stopPropagation()}
            >
              <h3>QR scannen</h3>
              <video ref={scannerVideoRef} className="pairing-scanner-video" muted playsInline />
              <p className="hint">Kamera auf den Pairing-QR-Code halten.</p>
              <button type="button" onClick={onCancelScanner}>
                Abbrechen
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
