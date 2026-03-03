import { upsertWeekEntry } from '../db/weekEntries'
import type { WeekEntry, WeekMode } from '../weekEntry'

function toISODate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getMondayISO(date: Date) {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  const dayIndex = (normalized.getDay() + 6) % 7
  normalized.setDate(normalized.getDate() - dayIndex)
  return toISODate(normalized)
}

function shiftWeek(weekStartISO: string, offsetWeeks: number) {
  const [yearText, monthText, dayText] = weekStartISO.split('-')
  const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
  date.setDate(date.getDate() + offsetWeeks * 7)
  return toISODate(date)
}

const modePattern: WeekMode[] = [
  'STABIL',
  'ANGESPANNT',
  'UEBERLAST',
  'ANGESPANNT',
  'STABIL',
  'KRISE',
  'UEBERLAST',
  'ANGESPANNT',
  'STABIL',
  'ANGESPANNT',
  'STABIL',
  'UEBERLAST',
]

const prioritiesPool: [string, string, string][] = [
  ['Team-Review vorbereiten', 'Kinderarzt-Termin organisieren', 'Wocheneinkauf planen'],
  ['Sprint-Abschluss sauber halten', 'Kita-Abholung teilen', 'Abendroutine ruhig halten'],
  ['Krankmeldung im Team abfangen', 'Haushalt nur Basics', 'Schlaf priorisieren'],
  ['Prio-Bug fixen', 'Elternabend koordinieren', 'Freitag ohne Termine halten'],
  ['Roadmap-Update finalisieren', 'Brotdosen vorbereiten', '2x Spaziergang einplanen'],
  ['Release ohne Überziehen', 'Notfall-Backup Betreuung', 'Arztunterlagen sortieren'],
]

const bottleneckPool = [
  'Schlafdefizit nach unruhigen Nächten.',
  'Krankheitswoche in der Familie und enges Übergabenfenster.',
  'Arbeitspeak mit mehreren Deadlines gleichzeitig.',
  'Viele Kleintermine, wenig zusammenhängende Fokuszeit.',
  'Logistik zwischen Kita, Schule und Meetings.',
  'Mentale Last durch Orga-Themen am Abend.',
]

const intentionallyNotDoingPool = [
  'Keine Zusatzprojekte nach 18 Uhr.',
  'Nicht alles perfekt dokumentieren.',
  'Keine spontanen Wochenendtermine annehmen.',
  'Kein Aufholen alter To-dos um jeden Preis.',
  'Nicht jede Nachricht sofort beantworten.',
  'Keine neuen Verpflichtungen außerhalb Kernaufgaben.',
]

export async function seedDemoData(): Promise<void> {
  const currentWeekMonday = getMondayISO(new Date())
  const entries: WeekEntry[] = []

  for (let i = 11; i >= 0; i -= 1) {
    const weekStartISO = shiftWeek(currentWeekMonday, -i)
    const now = new Date().toISOString()
    const poolIndex = (11 - i) % prioritiesPool.length

    entries.push({
      id: crypto.randomUUID(),
      weekStartISO,
      mode: modePattern[11 - i],
      priorities: prioritiesPool[poolIndex],
      bottleneck: bottleneckPool[poolIndex % bottleneckPool.length],
      intentionallyNotDoing:
        intentionallyNotDoingPool[poolIndex % intentionallyNotDoingPool.length],
      createdAt: now,
      updatedAt: now,
    })
  }

  for (const entry of entries) {
    await upsertWeekEntry(entry)
  }
}
