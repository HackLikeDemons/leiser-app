export type WeekMode = 'STABIL' | 'ANGESPANNT' | 'UEBERLAST' | 'KRISE'

export interface WeekEntry {
  id: string
  weekStartISO: string
  mode: WeekMode
  priorities: [string, string, string]
  bottleneck: string
  intentionallyNotDoing: string
  createdAt: string
  updatedAt: string
}

export interface WeekEntryDraft {
  mode: WeekMode
  priorities: [string, string, string]
  bottleneck: string
  intentionallyNotDoing: string
}

export const DEFAULT_WEEK_DRAFT: WeekEntryDraft = {
  mode: 'STABIL',
  priorities: ['', '', ''],
  bottleneck: '',
  intentionallyNotDoing: '',
}
