import { useEffect, useMemo, useState } from 'react'
import { Fragment } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { ModeTimeline, formatModeDistribution } from '../components/ModeTimeline'
import { listMonthEntries } from '../lib/db/monthEntries'
import { deleteWeekEntry, listWeekEntries } from '../lib/db/weekEntries'
import {
  formatTopTokens,
  getTopBottleneckTokens,
  getTopIntentionallyNotDoingTokens,
  runInsightsSelfCheck,
} from '../lib/insights'
import type { WeekEntry } from '../lib/weekEntry'
import type { MonthEntry } from '../lib/monthEntry'

export function HistoriePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [entries, setEntries] = useState<WeekEntry[]>([])
  const [monthEntries, setMonthEntries] = useState<MonthEntry[]>([])
  const [error, setError] = useState<string>('')
  const bottleneckTopTokens = useMemo(() => getTopBottleneckTokens(entries, 5), [entries])
  const intentionallyNotDoingTopTokens = useMemo(
    () => getTopIntentionallyNotDoingTokens(entries, 5),
    [entries],
  )

  useEffect(() => {
    let cancelled = false

    const loadEntries = async () => {
      try {
        const [nextEntries, nextMonthEntries] = await Promise.all([listWeekEntries(12), listMonthEntries(6)])
        if (!cancelled) {
          setEntries(nextEntries)
          setMonthEntries(nextMonthEntries)
        }
      } catch {
        if (!cancelled) {
          setError('Historie konnte nicht geladen werden.')
        }
      }
    }

    void loadEntries()

    return () => {
      cancelled = true
    }
  }, [location.search])

  useEffect(() => {
    if (import.meta.env.DEV && !runInsightsSelfCheck()) {
      console.warn('Insights self-check failed.')
    }
  }, [])

  const handleDelete = async (entry: WeekEntry) => {
    const shouldDelete = window.confirm(`Eintrag ${entry.weekStartISO} wirklich löschen?`)
    if (!shouldDelete) {
      return
    }

    await deleteWeekEntry(entry.id)
    const nextEntries = await listWeekEntries(12)
    setEntries(nextEntries)
  }

  return (
    <section>
      <h2>Historie</h2>
      <p>Die letzten 12 Wochen lokal aus IndexedDB.</p>

      {error ? <p className="status-message">{error}</p> : null}

      <ModeTimeline entries={entries} onOpenWeek={(weekStartISO) => navigate(`/?week=${weekStartISO}`)} />
      {entries.length > 0 ? <p className="mode-distribution">{formatModeDistribution(entries)}</p> : null}
      <p className="insight-line">
        <strong>Monatsübersicht:</strong>{' '}
        {monthEntries.length > 0 ? (
          <span className="month-overview">
            {monthEntries.map((entry, index) => (
              <Fragment key={entry.id}>
                <button
                  type="button"
                  className="month-overview-link"
                  onClick={() => navigate(`/month?m=${entry.monthISO}`)}
                >
                  {entry.monthISO}: {entry.dominantMode || '—'}
                </button>
                {index < monthEntries.length - 1 ? <span className="month-overview-sep">·</span> : null}
              </Fragment>
            ))}
          </span>
        ) : (
          'Noch keine Monatseinträge.'
        )}
      </p>
      <p className="insight-line">
        <strong>Engpass-Spiegel:</strong>{' '}
        {bottleneckTopTokens.length > 0
          ? formatTopTokens(bottleneckTopTokens)
          : 'Noch keine Engpass-Muster erkennbar.'}
      </p>
      <p className="insight-line">
        <strong>Bewusst-nicht-Spiegel:</strong>{' '}
        {intentionallyNotDoingTopTokens.length > 0
          ? formatTopTokens(intentionallyNotDoingTopTokens)
          : "Noch keine Muster im 'bewusst nicht' erkennbar."}
      </p>

      <div className="history-table" role="table" aria-label="Historie">
        {entries.length === 0 ? <p>Noch keine Einträge vorhanden.</p> : null}

        {entries.map((entry) => (
          <div className="history-row" role="row" key={entry.id}>
            <button
              type="button"
              className="history-open"
              onClick={() => navigate(`/?week=${entry.weekStartISO}`)}
            >
              <span className="history-cell" role="cell">
                {entry.weekStartISO}
              </span>
              <span className="history-cell" role="cell">
                {entry.mode}
              </span>
              <span className="history-cell" role="cell">
                {entry.priorities[0] || 'Keine Priorität gesetzt'}
              </span>
            </button>
            <button type="button" className="history-delete" onClick={() => void handleDelete(entry)}>
              Löschen
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
