import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { addNote, deleteNote, listInboxNotes, listNotesByDay, updateNoteStatus } from './lib/dbNotes'
import { getLocalDayISO } from './lib/date'
import type { Note, NoteStatus } from './lib/types'

function toClockLabel(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function App() {
  const [mode, setMode] = useState<'BRAINDUMP' | 'REVIEW'>('BRAINDUMP')
  const [text, setText] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [inboxNotes, setInboxNotes] = useState<Note[]>([])
  const [reviewSessionTotal, setReviewSessionTotal] = useState(0)
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

  const loadInboxNotes = async (options?: { resetProgress?: boolean }) => {
    try {
      const openNotes = await listInboxNotes()
      setInboxNotes(openNotes)
      if (options?.resetProgress) {
        setReviewSessionTotal(openNotes.length)
      }
    } catch {
      setError('Review konnte nicht geladen werden.')
    }
  }

  useEffect(() => {
    void loadTodayNotes()
    void loadInboxNotes()
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
      await Promise.all([loadTodayNotes(), loadInboxNotes()])
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

  const handleReviewDecision = async (status: Exclude<NoteStatus, 'INBOX'>) => {
    const current = inboxNotes[0]
    if (!current) {
      return
    }

    setError('')
    try {
      await updateNoteStatus(current.id, status)
      await Promise.all([loadInboxNotes(), loadTodayNotes()])
    } catch {
      setError('Status konnte nicht aktualisiert werden.')
    }
  }

  const handleSkip = () => {
    if (inboxNotes.length <= 1) {
      return
    }
    setInboxNotes((prev) => [...prev.slice(1), prev[0]])
  }

  useEffect(() => {
    if (mode !== 'REVIEW') {
      return
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      if (isTypingTarget || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 't') {
        event.preventDefault()
        void handleReviewDecision('TODO')
      } else if (key === 'p') {
        event.preventDefault()
        void handleReviewDecision('PROCESS')
      } else if (key === 'd') {
        event.preventDefault()
        void handleReviewDecision('DISCARD')
      } else if (key === 's') {
        event.preventDefault()
        handleSkip()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, inboxNotes])

  const reviewTotal = reviewSessionTotal
  const reviewedCount = Math.max(0, reviewSessionTotal - inboxNotes.length)
  const currentReviewNote = inboxNotes[0]

  return (
    <main className="daily-shell">
      <section className="daily-card">
        <h1>Leiser</h1>
        <p className="subtitle">Täglicher Braindump. Komplett lokal.</p>

        <div className="mode-tabs" role="tablist" aria-label="Modus">
          <button
            type="button"
            className={mode === 'BRAINDUMP' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setMode('BRAINDUMP')}
          >
            Braindump
          </button>
          <button
            type="button"
            className={mode === 'REVIEW' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => {
              setMode('REVIEW')
              void loadInboxNotes({ resetProgress: true })
            }}
          >
            Review
          </button>
        </div>

        {mode === 'BRAINDUMP' ? (
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
            {notes.length === 0 ? <p className="empty-text">Noch keine Notizen heute.</p> : null}

            <ul className="notes-list" aria-label="Heutige Notizen">
              {notes.map((note) => (
                <li key={note.id} className="note-item">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-text">{note.text}</span>
                  <button
                    type="button"
                    className="note-delete"
                    onClick={() => void handleDelete(note.id)}
                  >
                    Löschen
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {currentReviewNote ? (
              <>
                <p className="review-progress">
                  {reviewedCount} von {reviewTotal} Gedanken geprüft
                </p>
                <article className="review-card">
                  <p className="review-meta">
                    {currentReviewNote.dayISO} · {toClockLabel(currentReviewNote.createdAt)}
                  </p>
                  <p className="review-text">{currentReviewNote.text}</p>
                  <div className="review-actions">
                    <button type="button" onClick={() => void handleReviewDecision('TODO')}>
                      To-Do
                    </button>
                    <button type="button" onClick={() => void handleReviewDecision('PROCESS')}>
                      Weiterdenken
                    </button>
                    <button type="button" onClick={() => void handleReviewDecision('DISCARD')}>
                      Verwerfen
                    </button>
                    <button type="button" onClick={handleSkip}>
                      Überspringen
                    </button>
                  </div>
                </article>
              </>
            ) : (
              <p className="empty-text">Keine offenen Gedanken.</p>
            )}
          </>
        )}

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  )
}
