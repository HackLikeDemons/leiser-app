import type { Note } from './types'

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function getLocalDayISO(date = new Date()): string {
  const normalized = new Date(date)
  normalized.setHours(12, 0, 0, 0)

  const year = normalized.getFullYear()
  const month = pad(normalized.getMonth() + 1)
  const day = pad(normalized.getDate())

  return `${year}-${month}-${day}`
}

export function getYesterdayISO(date = new Date()): string {
  const yesterday = new Date(date)
  yesterday.setDate(yesterday.getDate() - 1)
  return getLocalDayISO(yesterday)
}

export function getDayDividerLabel(dayISO: string, todayISO: string, yesterdayISO: string) {
  if (dayISO === todayISO) return 'Heute'
  if (dayISO === yesterdayISO) return 'Gestern'
  return dayISO
}

export type NoteDayGroup = {
  dayISO: string
  label: string
  notes: Note[]
}

type GroupNotesByDayOptions = {
  todayISO: string
  yesterdayISO: string
  daySort?: 'asc' | 'desc'
  noteSort?: (a: Note, b: Note) => number
}

export function groupNotesByDay(notes: Note[], options: GroupNotesByDayOptions): NoteDayGroup[] {
  const grouped = new Map<string, Note[]>()
  for (const note of notes) {
    const dayNotes = grouped.get(note.dayISO)
    if (dayNotes) {
      dayNotes.push(note)
    } else {
      grouped.set(note.dayISO, [note])
    }
  }

  const sortedDays = [...grouped.keys()].sort((a, b) =>
    options.daySort === 'asc' ? a.localeCompare(b) : b.localeCompare(a),
  )

  return sortedDays.map((dayISO) => {
    const dayNotes = [...(grouped.get(dayISO) ?? [])]
    if (options.noteSort) {
      dayNotes.sort(options.noteSort)
    }
    return {
      dayISO,
      label: getDayDividerLabel(dayISO, options.todayISO, options.yesterdayISO),
      notes: dayNotes,
    }
  })
}
