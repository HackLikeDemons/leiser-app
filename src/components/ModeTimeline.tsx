import { useMemo } from 'react'
import type { WeekEntry, WeekMode } from '../lib/weekEntry'

type ModeTimelineProps = {
  entries: WeekEntry[]
  onOpenWeek?: (weekStartISO: string) => void
}

const modeLabel: Record<WeekMode, string> = {
  STABIL: 'Stabil',
  ANGESPANNT: 'Angespannt',
  UEBERLAST: 'Überlast',
  KRISE: 'Krise',
}

export function ModeTimeline({ entries, onOpenWeek }: ModeTimelineProps) {
  const ascendingEntries = useMemo(() => [...entries].reverse(), [entries])

  if (ascendingEntries.length === 0) {
    return (
      <div className="mode-timeline-block">
        <p className="mode-timeline-empty">Noch keine Wochen in der Timeline.</p>
      </div>
    )
  }

  return (
    <div className="mode-timeline-block">
      <div className="mode-timeline" aria-label="Modus-Timeline der letzten Wochen">
        {ascendingEntries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`mode-pill mode-pill--${entry.mode.toLowerCase()}`}
            title={`${entry.weekStartISO} – ${entry.mode}`}
            aria-label={`${entry.weekStartISO} – ${entry.mode}`}
            onClick={() => onOpenWeek?.(entry.weekStartISO)}
          />
        ))}
      </div>
      <p className="mode-timeline-caption">Links älter · rechts neuer</p>
    </div>
  )
}

export function formatModeDistribution(entries: WeekEntry[]) {
  const counts: Record<WeekMode, number> = {
    STABIL: 0,
    ANGESPANNT: 0,
    UEBERLAST: 0,
    KRISE: 0,
  }

  for (const entry of entries) {
    counts[entry.mode] += 1
  }

  return `Letzte 12 Wochen: ${counts.STABIL} ${modeLabel.STABIL} · ${counts.ANGESPANNT} ${modeLabel.ANGESPANNT} · ${counts.UEBERLAST} ${modeLabel.UEBERLAST} · ${counts.KRISE} ${modeLabel.KRISE}`
}
