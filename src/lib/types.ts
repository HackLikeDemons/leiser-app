export type NoteStatus = 'INBOX' | 'TODO' | 'PROCESS' | 'DISCARD' | 'ARCHIVE'
export type NoteType = 'NOTE' | 'QUESTION' | 'IDEA' | 'TASK'

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
  type: NoteType
}
