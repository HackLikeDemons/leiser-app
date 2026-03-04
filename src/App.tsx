import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { addNote, deleteNote, listNotesByDay } from './lib/dbNotes'
import { getLocalDayISO } from './lib/date'
import type { Note } from './lib/types'

function toClockLabel(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function App() {
  const [text, setText] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState('')

  const todayISO = useMemo(() => getLocalDayISO(), [])

  const loadTodayNotes = async () => {
    try {
      const todayNotes = await listNotesByDay(todayISO)
      setNotes(todayNotes)
    } catch {
      setError('Notizen konnten nicht geladen werden.')
    }
  }

  useEffect(() => {
    void loadTodayNotes()
  }, [todayISO])

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    setError('')
    try {
      await addNote(trimmed)
      setText('')
      await loadTodayNotes()
    } catch {
      setError('Notiz konnte nicht gespeichert werden.')
    }
  }

  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm('Notiz löschen?')
    if (!confirmed) {
      return
    }

    setError('')
    try {
      await deleteNote(id)
      await loadTodayNotes()
    } catch {
      setError('Notiz konnte nicht gelöscht werden.')
    }
  }

  return (
    <main className="daily-shell">
      <section className="daily-card">
        <h1>Leiser</h1>
        <p className="subtitle">Täglicher Braindump. Komplett lokal.</p>

        <form className="capture-form" onSubmit={(event) => void handleSubmit(event)}>
          <textarea
            rows={4}
            placeholder="Gedanken festhalten..."
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleTextKeyDown}
          />
          <button type="submit">Hinzufügen</button>
        </form>

        {error ? <p className="error-text">{error}</p> : null}

        <h2>Heute</h2>
        {notes.length === 0 ? <p className="empty-text">Noch keine Notizen heute.</p> : null}

        <ul className="notes-list" aria-label="Heutige Notizen">
          {notes.map((note) => (
            <li key={note.id} className="note-item">
              <span className="note-time">{toClockLabel(note.createdAt)}</span>
              <span className="note-text">{note.text}</span>
              <button type="button" className="note-delete" onClick={() => void handleDelete(note.id)}>
                Löschen
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
