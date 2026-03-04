import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import {
  addNote,
  deleteNote,
  listInboxNotes,
  listNotesByDay,
  listProcessNotes,
  updateNoteStatus,
} from './lib/dbNotes'
import { getLocalDayISO } from './lib/date'
import type { Note, NoteStatus } from './lib/types'

type TabKey = 'BRAINDUMP' | 'REVIEW' | 'THINKING'

function toClockLabel(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('BRAINDUMP')
  const [text, setText] = useState('')
  const [todayNotes, setTodayNotes] = useState<Note[]>([])
  const [inboxNotes, setInboxNotes] = useState<Note[]>([])
  const [processNotes, setProcessNotes] = useState<Note[]>([])
  const [error, setError] = useState('')

  const todayISO = useMemo(() => getLocalDayISO(), [])

  const refreshAll = async () => {
    try {
      const [today, inbox, process] = await Promise.all([
        listNotesByDay(todayISO, 500),
        listInboxNotes(200),
        listProcessNotes(200),
      ])
      setTodayNotes(today)
      setInboxNotes(inbox)
      setProcessNotes(process)
    } catch {
      setError('Daten konnten nicht geladen werden.')
    }
  }

  useEffect(() => {
    void refreshAll()
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
      await refreshAll()
    } catch {
      setError('Notiz konnte nicht gespeichert werden.')
    }
  }

  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
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
      await refreshAll()
    } catch {
      setError('Notiz konnte nicht gelöscht werden.')
    }
  }

  const handleReviewDecision = async (id: string, status: Exclude<NoteStatus, 'INBOX'>) => {
    setError('')
    try {
      await updateNoteStatus(id, status)
      await refreshAll()
    } catch {
      setError('Status konnte nicht aktualisiert werden.')
    }
  }

  return (
    <main className="daily-shell">
      <section className="daily-card">
        <h1>Leiser</h1>
        <p className="subtitle">Täglicher Braindump. Komplett lokal.</p>

        <div className="mode-tabs" role="tablist" aria-label="Bereiche">
          <button
            type="button"
            className={activeTab === 'BRAINDUMP' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setActiveTab('BRAINDUMP')}
          >
            Braindump
          </button>
          <button
            type="button"
            className={activeTab === 'REVIEW' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setActiveTab('REVIEW')}
          >
            Review
          </button>
          <button
            type="button"
            className={activeTab === 'THINKING' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setActiveTab('THINKING')}
          >
            Denken
          </button>
        </div>

        {activeTab === 'BRAINDUMP' ? (
          <>
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

            <h2>Heute</h2>
            {todayNotes.length === 0 ? <p className="empty-text">Noch keine Notizen heute.</p> : null}
            <ul className="notes-list" aria-label="Heutige Notizen">
              {todayNotes.map((note) => (
                <li key={note.id} className="note-item">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-text">{note.text}</span>
                  <button type="button" className="note-delete" onClick={() => void handleDelete(note.id)}>
                    Löschen
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {activeTab === 'REVIEW' ? (
          <>
            <h2>Offen</h2>
            {inboxNotes.length === 0 ? <p className="empty-text">Keine offenen Gedanken.</p> : null}
            <ul className="notes-list" aria-label="Offene Gedanken">
              {inboxNotes.map((note) => (
                <li key={note.id} className="note-item note-item--review">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-text">{note.text}</span>
                  <div className="review-actions-inline">
                    <button type="button" onClick={() => void handleReviewDecision(note.id, 'TODO')}>
                      TODO
                    </button>
                    <button type="button" onClick={() => void handleReviewDecision(note.id, 'PROCESS')}>
                      PROCESS
                    </button>
                    <button type="button" onClick={() => void handleReviewDecision(note.id, 'DISCARD')}>
                      DISCARD
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {activeTab === 'THINKING' ? (
          <>
            <h2>Denken</h2>
            {processNotes.length === 0 ? <p className="empty-text">Keine Gedanken im Denken-Modus.</p> : null}
            <ul className="notes-list" aria-label="Denken Notizen">
              {processNotes.map((note) => (
                <li key={note.id} className="note-item">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-text">{note.text}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  )
}
