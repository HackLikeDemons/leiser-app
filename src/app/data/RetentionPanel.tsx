type MaintenanceLogEntry = {
  id: string
  at: string
  message: string
}

type ArchiveWarningEntry = {
  id: string
  text: string
  daysLeft: number
  scopeLabel: string
}

type RetentionPanelProps = {
  maintenanceLog: MaintenanceLogEntry[]
  archiveWarnings: ArchiveWarningEntry[]
}

function formatTimestamp(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) {
    return 'Unbekannter Zeitpunkt'
  }
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function daysLeftLabel(daysLeft: number) {
  if (daysLeft <= 1) {
    return 'noch 1 Tag'
  }
  return `noch ${daysLeft} Tage`
}

export type { ArchiveWarningEntry, MaintenanceLogEntry }

export function RetentionPanel({ maintenanceLog, archiveWarnings }: RetentionPanelProps) {
  const visibleWarnings = archiveWarnings.slice(0, 8)
  const hiddenWarningCount = archiveWarnings.length - visibleWarnings.length

  return (
    <section className="data-card" aria-label="Aufbewahrung">
      <h3>Aufbewahrung</h3>
      <p className="hint data-card__intro">Automatische Regeln verschieben alte Handlungen zurück in die Inbox und löschen alte Archiv-Einträge nach 30 Tagen endgültig.</p>

      <div className="retention-block">
        <h4>Bevorstehende Archiv-Löschungen</h4>
        {archiveWarnings.length > 0 ? (
          <>
            <p className="hint retention-warning-summary">
              {archiveWarnings.length} Archiv-Eintrag{archiveWarnings.length === 1 ? '' : 'e'} werden innerhalb der nächsten 7 Tage endgültig gelöscht.
            </p>
            <ul className="retention-list">
              {visibleWarnings.map((entry) => (
                <li key={entry.id} className="retention-list__item">
                  <span className="retention-list__title">{entry.scopeLabel}</span>
                  <span className="retention-list__meta">{daysLeftLabel(entry.daysLeft)}</span>
                  <span className="retention-list__text">{entry.text}</span>
                </li>
              ))}
            </ul>
            {hiddenWarningCount > 0 ? (
              <p className="hint">Plus {hiddenWarningCount} weitere Einträge.</p>
            ) : null}
          </>
        ) : (
          <p className="hint">Aktuell steht keine automatische Archiv-Löschung kurz bevor.</p>
        )}
      </div>

      <div className="retention-block">
        <h4>Letzte automatische Änderungen</h4>
        {maintenanceLog.length > 0 ? (
          <ul className="retention-log">
            {maintenanceLog.map((entry) => (
              <li key={entry.id} className="retention-log__item">
                <span className="retention-log__time">{formatTimestamp(entry.at)}</span>
                <span className="retention-log__message">{entry.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Noch keine automatischen Änderungen protokolliert.</p>
        )}
      </div>
    </section>
  )
}
