export type NoteStatus = 'INBOX' | 'TODO' | 'PROCESS' | 'DISCARD'

export type Note = {
  id: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  deviceId: string
  revision: number
  dayISO: string
  text: string
  status: NoteStatus
}
