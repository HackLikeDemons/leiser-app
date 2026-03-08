import type { ImportMode, ImportReport } from '../../lib/backup'
import { FlowHero } from '../FlowHero'
import { BackupPanel } from './BackupPanel'

type BackupScreenProps = {
  onBackToSettings: () => void
  onExport: () => void
  showImportPanel: boolean
  onToggleImportPanel: () => void
  onImportFileChange: (file: File | null) => void
  importMode: ImportMode
  onImportModeChange: (mode: ImportMode) => void
  onImport: () => void
  lastBackupAtLabel: string
  backupOverdue: boolean
  importReport: ImportReport | null
  info: string
  offlineReady: boolean
}

export function BackupScreen({
  onBackToSettings,
  onExport,
  showImportPanel,
  onToggleImportPanel,
  onImportFileChange,
  importMode,
  onImportModeChange,
  onImport,
  lastBackupAtLabel,
  backupOverdue,
  importReport,
  info,
  offlineReady,
}: BackupScreenProps) {
  return (
    <section className="data-section" aria-label="Backup">
      <FlowHero
        title="Backup"
        subtitle="Sichere deine Daten regelmäßig und stelle sie bei Bedarf wieder her."
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
          <BackupPanel
            onExport={onExport}
            onToggleImportPanel={onToggleImportPanel}
            showImportPanel={showImportPanel}
            onImportFileChange={onImportFileChange}
            importMode={importMode}
            onImportModeChange={onImportModeChange}
            onImport={onImport}
            lastBackupAtLabel={lastBackupAtLabel}
            backupOverdue={backupOverdue}
            importReport={importReport}
            info={info}
            offlineReady={offlineReady}
          />
        </div>
      </div>
    </section>
  )
}
