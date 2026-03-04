export type NoteStatus = 'INBOX' | 'TODO' | 'PROCESS' | 'DISCARD'

export type Note = {
  id: string
  createdAt: string
  updatedAt?: string
  dayISO: string
  text: string
  status: NoteStatus
}
