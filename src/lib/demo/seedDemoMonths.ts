import { upsertMonthEntryByMonthISO } from '../db/monthEntries'
import type { MonthMode } from '../monthEntry'

function toMonthISO(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function shiftMonth(monthISO: string, offset: number) {
  const [yearText, monthText] = monthISO.split('-')
  const date = new Date(Number(yearText), Number(monthText) - 1, 1)
  date.setMonth(date.getMonth() + offset)
  date.setDate(1)
  return toMonthISO(date)
}

const modePattern: MonthMode[] = ['ANGESPANNT', 'STABIL', 'UEBERLAST', 'STABIL', 'ANGESPANNT', 'UEBERLAST']

const reflectionPool = [
  'Viele Termine, wenig Puffer. Mehr Ruhe am Wochenende hat geholfen.',
  'Krankheitsphase in der Familie, Fokus auf Stabilität im Alltag.',
  'Arbeitspeak im Team. Haushalt bewusst reduziert und Prioritäten eng gesetzt.',
  'Weniger Außenreize haben gutgetan. Routinen liefen insgesamt ruhiger.',
  'Mehr Übergaben zwischen Arbeit und Familie, wenig Leerlauf.',
  'Ein dichter Monat, aber mit klaren Grenzen am Abend besser gehalten.',
]

export async function seedDemoMonths(options?: { months?: number }): Promise<void> {
  const months = Math.max(1, options?.months ?? 6)
  const currentMonth = toMonthISO(new Date())

  for (let i = months - 1; i >= 0; i -= 1) {
    const monthISO = shiftMonth(currentMonth, -i)
    const idx = (months - 1 - i) % modePattern.length

    await upsertMonthEntryByMonthISO({
      monthISO,
      dominantMode: modePattern[idx],
      reflection: reflectionPool[idx % reflectionPool.length],
    })
  }
}
