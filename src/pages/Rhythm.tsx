import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { ModeTimeline, formatModeDistribution } from '../components/ModeTimeline'
import { listMonthEntries } from '../lib/db/monthEntries'
import { listWeekEntries } from '../lib/db/weekEntries'
import {
  formatTopTokens,
  getTopBottleneckTokens,
  getTopIntentionallyNotDoingTokens,
} from '../lib/insights'
import type { MonthEntry } from '../lib/monthEntry'
import { buildRhythmSummary, runRhythmSummarySelfCheck } from '../lib/rhythmSummary'
import type { WeekEntry } from '../lib/weekEntry'

function clipNote(note: string, limit = 40) {
  const normalized = note.trim()
  if (!normalized) {
    return ''
  }
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit).trimEnd()}...`
}

export function RhythmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [weekEntries, setWeekEntries] = useState<WeekEntry[]>([])
  const [monthEntries, setMonthEntries] = useState<MonthEntry[]>([])
  const [error, setError] = useState('')

  const bottleneckTopTokens = useMemo(() => getTopBottleneckTokens(weekEntries, 5), [weekEntries])
  const intentionallyNotDoingTopTokens = useMemo(
    () => getTopIntentionallyNotDoingTokens(weekEntries, 5),
    [weekEntries],
  )
  const summary = useMemo(() => buildRhythmSummary(weekEntries), [weekEntries])

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
      try {
        const [nextWeeks, nextMonths] = await Promise.all([listWeekEntries(12), listMonthEntries(6)])
        if (!cancelled) {
          setWeekEntries(nextWeeks)
          setMonthEntries(nextMonths)
        }
      } catch {
        if (!cancelled) {
          setError('Rhythmus-Übersicht konnte nicht geladen werden.')
        }
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [location.search])

  useEffect(() => {
    if (import.meta.env.DEV && !runRhythmSummarySelfCheck()) {
      console.warn('Rhythm summary self-check failed.')
    }
  }, [])

  return (
    <section>
      <h2>Rhythmus</h2>
      <p>Eine ruhige Übersicht über wiederkehrende Muster.</p>

      {error ? <p className="status-message">{error}</p> : null}

      <h3 className="rhythm-heading">Letzte 12 Wochen</h3>
      <ModeTimeline entries={weekEntries} onOpenWeek={(weekStartISO) => navigate(`/?week=${weekStartISO}`)} />
      {weekEntries.length > 0 ? (
        <p className="mode-distribution">{formatModeDistribution(weekEntries)}</p>
      ) : (
        <p className="mode-distribution">Noch keine Wochenmuster vorhanden.</p>
      )}

      <h3 className="rhythm-heading">Engpass-Muster</h3>
      <p className="insight-line">
        {bottleneckTopTokens.length > 0
          ? formatTopTokens(bottleneckTopTokens)
          : 'Noch keine Engpass-Muster erkennbar.'}
      </p>

      <h3 className="rhythm-heading">Bewusst nicht</h3>
      <p className="insight-line">
        {intentionallyNotDoingTopTokens.length > 0
          ? formatTopTokens(intentionallyNotDoingTopTokens)
          : "Noch keine Muster im 'bewusst nicht' erkennbar."}
      </p>

      <h3 className="rhythm-heading">Letzte 6 Monate</h3>
      {monthEntries.length > 0 ? (
        <p className="insight-line">
          <span className="month-overview">
            {monthEntries.map((entry, index) => (
              <Fragment key={entry.id}>
                <button
                  type="button"
                  className="month-overview-link"
                  onClick={() => navigate(`/month?m=${entry.monthISO}`)}
                >
                  {entry.monthISO}: {entry.dominantMode || '—'}
                  {clipNote(entry.reflection)
                    ? ` - ${clipNote(entry.reflection)}`
                    : ''}
                </button>
                {index < monthEntries.length - 1 ? <span className="month-overview-sep">·</span> : null}
              </Fragment>
            ))}
          </span>
        </p>
      ) : (
        <p className="insight-line">Noch keine Monatseinträge.</p>
      )}

      <h3 className="rhythm-heading">Ruhiger Rückblick</h3>
      <p className="insight-line">{summary}</p>
    </section>
  )
}
