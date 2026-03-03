import type { WeekMode } from './weekEntry'

export type MonthMode = WeekMode | ''

export interface MonthEntry {
  id: string
  monthISO: string
  dominantMode?: MonthMode
  reflection: string
  createdAt: string
  updatedAt: string
}

export interface MonthEntryDraft {
  dominantMode: MonthMode
  reflection: string
}

export const DEFAULT_MONTH_DRAFT: MonthEntryDraft = {
  dominantMode: '',
  reflection: '',
}
