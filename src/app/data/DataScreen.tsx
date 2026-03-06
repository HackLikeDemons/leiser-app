import type { RefObject } from 'react'
import type { ImportMode, ImportReport } from '../../lib/backup'
import type { SyncDiagnostics, SyncUiStatus } from '../../lib/syncEngine'
import { FlowHero } from '../FlowHero'
import { PairingPanel } from './PairingPanel'
import { SyncPanel, type DevSyncInfo } from './SyncPanel'

type SupabaseConfigStatus = {
  configured: boolean
  source: 'runtime' | 'vite' | 'none'
}

type DataScreenProps = {
  onExport: () => void
  showImportPanel: boolean
  onToggleImportPanel: () => void
  onImportFileChange: (file: File | null) => void
  importMode: ImportMode
  onImportModeChange: (mode: ImportMode) => void
  onImport: () => void
  onToggleSyncEnabled: () => void
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
  onExport,
  showImportPanel,
  onToggleImportPanel,
  onImportFileChange,
  importMode,
  onImportModeChange,
  onImport,
  onToggleSyncEnabled,
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
        title="Sichern, verbinden, verwalten"
        subtitle=""
      />
      <div className="data-panel">
        <div className="data-layout">
          <SyncPanel
            onExport={onExport}
            onToggleImportPanel={onToggleImportPanel}
            showImportPanel={showImportPanel}
            onImportFileChange={onImportFileChange}
            importMode={importMode}
            onImportModeChange={onImportModeChange}
            onImport={onImport}
            onToggleSyncEnabled={onToggleSyncEnabled}
            syncEnabled={syncEnabled}
            onToggleDebugInfo={onToggleDebugInfo}
            showDebugInfo={showDebugInfo}
            onSyncNow={onSyncNow}
            onCopySyncProtocol={onCopySyncProtocol}
            syncNowBusy={syncNowBusy}
            lastBackupAtLabel={lastBackupAtLabel}
            backupOverdue={backupOverdue}
            importReport={importReport}
            info={info}
            offlineReady={offlineReady}
            syncStatus={syncStatus}
            syncError={syncError}
            supabaseConfigStatus={supabaseConfigStatus}
            devSyncInfo={devSyncInfo}
            syncDiagnostics={syncDiagnostics}
            formatSyncTimeLabel={formatSyncTimeLabel}
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
              <p className="hint">Nur mit Geräten teilen, denen du vertraust.</p>
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
