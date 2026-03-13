import type { ChangeEvent } from 'react'
import type { ImportMode, ImportReport } from '../../lib/backup'

type BackupPanelProps = {
  onExport: () => void
  onToggleImportPanel: () => void
  showImportPanel: boolean
  onImportFileChange: (file: File | null) => void
  importMode: ImportMode
  onImportModeChange: (mode: ImportMode) => void
  onImport: () => void
  lastBackupAtLabel: string
  backupOverdue: boolean
  importReport: ImportReport | null
  info: string
  offlineReady: boolean
  includeArchivedInExport: boolean
  onToggleIncludeArchivedInExport: (nextValue: boolean) => void
}

export function BackupPanel({
  onExport,
  onToggleImportPanel,
  showImportPanel,
  onImportFileChange,
  importMode,
  onImportModeChange,
  onImport,
  lastBackupAtLabel,
  backupOverdue,
  importReport,
  info,
  offlineReady,
  includeArchivedInExport,
  onToggleIncludeArchivedInExport,
}: BackupPanelProps) {
  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    onImportFileChange(event.target.files?.[0] ?? null)
  }

  return (
    <section className="data-card" aria-label="Backup">
      <h3>Backup</h3>
      <p className="hint data-card__intro">Erstelle regelmäßig ein Backup, damit du deine Daten jederzeit wiederherstellen kannst.</p>
      <div className="data-actions">
        <button type="button" className="review-btn review-btn--cta" onClick={onExport}>
          Backup exportieren
        </button>
        <button type="button" className="review-btn review-btn--cta" onClick={onToggleImportPanel}>
          {showImportPanel ? 'Import schließen' : 'Backup importieren'}
        </button>
      </div>

      <label className="settings-option settings-option--compact">
        <input
          type="checkbox"
          checked={includeArchivedInExport}
          onChange={(event) => onToggleIncludeArchivedInExport(event.target.checked)}
        />
        <span>Archivierte Einträge im Export einschließen</span>
      </label>
      <p className="hint">Aktive Einträge sind immer enthalten. Gelöschte Einträge bleiben ausgeschlossen.</p>

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
          <button type="button" className="review-btn review-btn--cta" onClick={onImport}>
            Import starten
          </button>
        </div>
      ) : null}

      <div className="data-status">
        <p className="hint">Letztes Backup: {lastBackupAtLabel}</p>
        {backupOverdue ? (
          <div className="backup-reminder">
            <p className="hint">Backup überfällig. Sichere jetzt deine Daten.</p>
            <button type="button" className="review-btn review-btn--cta" onClick={onExport}>
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
        {includeArchivedInExport ? <p className="hint">Der nächste Export enthält auch dein Archiv.</p> : null}
        {info ? <p className="hint">{info}</p> : null}
        {offlineReady ? <p className="hint">Offline bereit.</p> : null}
      </div>
    </section>
  )
}
