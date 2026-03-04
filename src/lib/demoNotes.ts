import { getOrCreateDeviceId } from './device'
import { getLocalDayISO } from './date'
import { upsertNote } from './dbNotes'
import type { Note } from './types'

type DemoSeed = {
  daysAgo: number
  hour: number
  minute: number
  text: string
  status: Note['status']
  type: Note['type']
}

const DEMO_SEEDS: DemoSeed[] = [
  { daysAgo: 1, hour: 8, minute: 10, text: 'Frage: Ist der Wochenplan zu voll?', status: 'INBOX', type: 'QUESTION' },
  { daysAgo: 1, hour: 20, minute: 5, text: 'Idee: Einkaufsliste am Abend vorbereiten', status: 'INBOX', type: 'IDEA' },
  { daysAgo: 2, hour: 7, minute: 45, text: 'Arzttermin für Freitag prüfen', status: 'TODO', type: 'TASK' },
  { daysAgo: 3, hour: 13, minute: 30, text: 'Gedanke zu Fokusblöcken bei der Arbeit', status: 'PROCESS', type: 'NOTE' },
  { daysAgo: 4, hour: 18, minute: 15, text: 'Warum wird es abends immer hektisch?', status: 'INBOX', type: 'QUESTION' },
  { daysAgo: 6, hour: 9, minute: 20, text: 'Notiz: Morgenroutine vereinfachen', status: 'ARCHIVE', type: 'NOTE' },
  { daysAgo: 8, hour: 11, minute: 0, text: 'Mit Kita über Abholzeiten sprechen', status: 'TODO', type: 'TASK' },
  { daysAgo: 10, hour: 16, minute: 40, text: 'Zu viele parallele Themen im Kopf', status: 'PROCESS', type: 'NOTE' },
  { daysAgo: 12, hour: 21, minute: 5, text: 'Idee: Sonntags Puffer für die Woche planen', status: 'ARCHIVE', type: 'IDEA' },
]

function toISOWithOffset(daysAgo: number, hour: number, minute: number) {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString()
}

export async function seedOlderThoughtsDemo() {
  const deviceId = getOrCreateDeviceId()
  const writes = DEMO_SEEDS.map(async (seed) => {
    const createdAt = toISOWithOffset(seed.daysAgo, seed.hour, seed.minute)
    const note: Note = {
      id: crypto.randomUUID(),
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      deviceId,
      revision: 1,
      dayISO: getLocalDayISO(new Date(createdAt)),
      text: seed.text,
      status: seed.status,
      type: seed.type,
      starred: false,
    }
    await upsertNote(note)
  })

  await Promise.all(writes)
}
