const historyEntries = [
  { week: 'KW 07', note: 'Konzept und Umfang abgestimmt' },
  { week: 'KW 08', note: 'Erste Inhalte erstellt und getestet' },
  { week: 'KW 09', note: 'Offline-Verhalten verbessert' },
]

export function HistoriePage() {
  return (
    <section>
      <h2>Historie</h2>
      <p>Hier liegen die letzten Einträge als statische Beispielhistorie.</p>
      <div className="history-table" role="table" aria-label="Historie">
        {historyEntries.map((entry) => (
          <div className="history-row" role="row" key={entry.week}>
            <span className="history-cell" role="cell">
              {entry.week}
            </span>
            <span className="history-cell" role="cell">
              {entry.note}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
