import type { WeekEntry, WeekMode } from './weekEntry'

type RunInfo = {
  mode: WeekMode
  length: number
}

function findLongestStressRun(entries: WeekEntry[]): RunInfo | null {
  if (entries.length === 0) {
    return null
  }

  let best: RunInfo | null = null
  let currentMode: WeekMode | null = null
  let currentLength = 0

  for (const entry of entries) {
    const mode = entry.mode

    if (mode === currentMode) {
      currentLength += 1
    } else {
      currentMode = mode
      currentLength = 1
    }

    if (mode === 'STABIL') {
      continue
    }

    if (!best || currentLength > best.length) {
      best = { mode, length: currentLength }
    }
  }

  return best
}

function isStabilDominant(entries: WeekEntry[]): boolean {
  const counts: Record<WeekMode, number> = {
    STABIL: 0,
    ANGESPANNT: 0,
    UEBERLAST: 0,
    KRISE: 0,
  }

  for (const entry of entries) {
    counts[entry.mode] += 1
  }

  return (
    counts.STABIL > counts.ANGESPANNT &&
    counts.STABIL > counts.UEBERLAST &&
    counts.STABIL > counts.KRISE
  )
}

export function buildRhythmSummary(entries: WeekEntry[]): string {
  if (entries.length === 0) {
    return 'Die letzten Wochen waren wechselhaft.'
  }

  const longestRun = findLongestStressRun(entries)
  if (longestRun && longestRun.length >= 3) {
    return `Es gab eine längere Phase von ${longestRun.mode} über ${longestRun.length} Wochen.`
  }

  if (isStabilDominant(entries)) {
    return 'In den letzten Wochen war überwiegend STABIL.'
  }

  return 'Die letzten Wochen waren wechselhaft.'
}

export function runRhythmSummarySelfCheck(): boolean {
  const entries: WeekEntry[] = [
    {
      id: '1',
      weekStartISO: '2026-01-05',
      mode: 'ANGESPANNT',
      priorities: ['', '', ''],
      bottleneck: '',
      intentionallyNotDoing: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: '2',
      weekStartISO: '2026-01-12',
      mode: 'ANGESPANNT',
      priorities: ['', '', ''],
      bottleneck: '',
      intentionallyNotDoing: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: '3',
      weekStartISO: '2026-01-19',
      mode: 'ANGESPANNT',
      priorities: ['', '', ''],
      bottleneck: '',
      intentionallyNotDoing: '',
      createdAt: '',
      updatedAt: '',
    },
  ]

  return buildRhythmSummary(entries) === 'Es gab eine längere Phase von ANGESPANNT über 3 Wochen.'
}
