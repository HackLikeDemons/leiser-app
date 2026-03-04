import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import {
  addNote,
  countInboxNotes,
  deleteNote,
  listDecidedNotesByDay,
  listInboxNotes,
  listNotesByDay,
  updateNoteText,
  updateNoteStatus,
} from './lib/dbNotes'
import { getLocalDayISO } from './lib/date'
import type { Note, NoteStatus } from './lib/types'

const FRESH_HOURS = 12
const OVERDUE_DAYS = 3

function toClockLabel(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function getNoteAgeMs(note: Note, now = new Date()) {
  const createdAtMs = Date.parse(note.createdAt)
  if (Number.isNaN(createdAtMs)) {
    return 0
  }
  return now.getTime() - createdAtMs
}

function isFreshNote(note: Note, now = new Date()) {
  const freshWindowMs = FRESH_HOURS * 60 * 60 * 1000
  return getNoteAgeMs(note, now) < freshWindowMs
}

function getNoteAgeCategory(note: Note): 'FRESH' | 'READY' | 'OVERDUE' {
  const ageMs = getNoteAgeMs(note)
  const freshWindowMs = FRESH_HOURS * 60 * 60 * 1000
  const overdueWindowMs = OVERDUE_DAYS * 24 * 60 * 60 * 1000

  if (ageMs < freshWindowMs) {
    return 'FRESH'
  }
  if (ageMs >= overdueWindowMs) {
    return 'OVERDUE'
  }
  return 'READY'
}

export function App() {
  const [mode, setMode] = useState<'BRAINDUMP' | 'REVIEW'>('BRAINDUMP')
  const [text, setText] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [inboxNotes, setInboxNotes] = useState<Note[]>([])
  const [todayDecidedNotes, setTodayDecidedNotes] = useState<Note[]>([])
  const [hasMoreInboxNotes, setHasMoreInboxNotes] = useState(false)
  const [showDecidedToday, setShowDecidedToday] = useState(false)
  const [reviewSessionTotal, setReviewSessionTotal] = useState(0)
  const [reviewCurrentId, setReviewCurrentId] = useState<string | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
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
      const [openNotes, totalInbox] = await Promise.all([listInboxNotes(50), countInboxNotes()])
      setInboxNotes(openNotes)
      setHasMoreInboxNotes(totalInbox > openNotes.length)
      if (options?.resetProgress) {
        setReviewSessionTotal(openNotes.length)
        setReviewCurrentId(null)
      }
    } catch {
      setError('Review konnte nicht geladen werden.')
    }
  }

  const loadTodayDecidedNotes = async () => {
    try {
      const decided = await listDecidedNotesByDay(todayISO)
      setTodayDecidedNotes(decided)
    } catch {
      setError('Entschiedene Notizen konnten nicht geladen werden.')
    }
  }

  useEffect(() => {
    void loadTodayNotes()
    void loadInboxNotes()
    void loadTodayDecidedNotes()
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
      await Promise.all([loadTodayNotes(), loadInboxNotes(), loadTodayDecidedNotes()])
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
      await Promise.all([loadTodayNotes(), loadInboxNotes(), loadTodayDecidedNotes()])
    } catch {
      setError('Notiz konnte nicht gelöscht werden.')
    }
  }

  const handleReviewDecision = async (noteId: string, status: Exclude<NoteStatus, 'INBOX'>) => {
    if (!noteId) {
      return
    }

    setError('')
    try {
      await updateNoteStatus(noteId, status)
      setReviewCurrentId(null)
      await Promise.all([loadInboxNotes(), loadTodayNotes(), loadTodayDecidedNotes()])
    } catch {
      setError('Status konnte nicht aktualisiert werden.')
    }
  }

  const handleMergeIntoTarget = async (sourceId: string) => {
    if (!mergeTargetId || mergeTargetId === sourceId) {
      return
    }

    const target = inboxNotes.find((note) => note.id === mergeTargetId)
    const source = inboxNotes.find((note) => note.id === sourceId)
    if (!target || !source) {
      return
    }

    const mergedText = `${target.text}\n\n${source.text}`

    setError('')
    try {
      await updateNoteText(target.id, mergedText)
      await deleteNote(source.id)
      setMergeTargetId(null)
      await Promise.all([loadInboxNotes(), loadTodayNotes(), loadTodayDecidedNotes()])
    } catch {
      setError('Zusammenführen fehlgeschlagen.')
    }
  }

  const handleReturnToInbox = async (noteId: string) => {
    setError('')
    try {
      await updateNoteStatus(noteId, 'INBOX')
      setReviewCurrentId(null)
      await Promise.all([loadInboxNotes(), loadTodayNotes(), loadTodayDecidedNotes()])
    } catch {
      setError('Notiz konnte nicht zurückgesetzt werden.')
    }
  }

  const overdueNotes = useMemo(
    () => inboxNotes.filter((note) => getNoteAgeCategory(note) === 'OVERDUE'),
    [inboxNotes],
  )
  const readyNotes = useMemo(
    () => inboxNotes.filter((note) => getNoteAgeCategory(note) === 'READY'),
    [inboxNotes],
  )
  const freshNotes = useMemo(
    () => inboxNotes.filter((note) => getNoteAgeCategory(note) === 'FRESH'),
    [inboxNotes],
  )
  const reviewSequence = useMemo(
    () => [...overdueNotes, ...readyNotes, ...freshNotes],
    [overdueNotes, readyNotes, freshNotes],
  )

  useEffect(() => {
    if (mode !== 'REVIEW') {
      return
    }

    if (reviewSequence.length === 0) {
      setReviewCurrentId(null)
      return
    }

    const exists = reviewSequence.some((note) => note.id === reviewCurrentId)
    if (!exists) {
      setReviewCurrentId(reviewSequence[0].id)
    }
  }, [mode, reviewCurrentId, reviewSequence])

  const currentReviewNote = reviewSequence.find((note) => note.id === reviewCurrentId) ?? null

  const handleSkip = () => {
    if (!currentReviewNote || reviewSequence.length <= 1) {
      return
    }
    const currentIndex = reviewSequence.findIndex((note) => note.id === currentReviewNote.id)
    const nextIndex = (currentIndex + 1) % reviewSequence.length
    setReviewCurrentId(reviewSequence[nextIndex].id)
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
      if (!currentReviewNote) {
        return
      }

      if (key === 't') {
        event.preventDefault()
        void handleReviewDecision(currentReviewNote.id, 'TODO')
      } else if (key === 'p') {
        event.preventDefault()
        void handleReviewDecision(currentReviewNote.id, 'PROCESS')
      } else if (key === 'd') {
        event.preventDefault()
        void handleReviewDecision(currentReviewNote.id, 'DISCARD')
      } else if (key === 's') {
        event.preventDefault()
        handleSkip()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentReviewNote, mode, reviewSequence])

  const reviewTotal = reviewSessionTotal
  const reviewedCount = Math.max(0, reviewSessionTotal - inboxNotes.length)

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
            <h2>Offen</h2>
            {inboxNotes.length === 0 ? <p className="empty-text">Keine offenen Gedanken.</p> : null}
            {overdueNotes.length === 0 && readyNotes.length === 0 && freshNotes.length > 0 ? (
              <p className="empty-text">Keine älteren Gedanken. Nur frische Einträge.</p>
            ) : null}

            {inboxNotes.length > 0 ? (
              <div className="review-groups">
                {overdueNotes.length > 0 ? (
                  <div>
                    <p className="review-group-line">Überfällig ({overdueNotes.length})</p>
                    <ul className="review-list">
                      {overdueNotes.map((note) => (
                        <li key={note.id}>
                          <div className="review-list-row">
                            <button
                              type="button"
                              className={
                                currentReviewNote?.id === note.id
                                  ? 'review-list-item review-list-item--active review-list-item--overdue'
                                  : 'review-list-item review-list-item--overdue'
                              }
                              onClick={() => setReviewCurrentId(note.id)}
                            >
                              <span>{toClockLabel(note.createdAt)}</span>
                              <span>{note.text}</span>
                              <span className="review-list-badge review-list-badge--overdue">ÜBERFÄLLIG</span>
                              {mergeTargetId === note.id ? (
                                <span className="review-list-marker">Merging in diese Notiz</span>
                              ) : null}
                            </button>
                            <div className="review-row-actions">
                              {mergeTargetId === note.id ? (
                                <button type="button" onClick={() => setMergeTargetId(null)}>
                                  Merge beenden
                                </button>
                              ) : mergeTargetId ? (
                                <button type="button" onClick={() => void handleMergeIntoTarget(note.id)}>
                                  → hierhin zusammenführen
                                </button>
                              ) : (
                                <button type="button" onClick={() => setMergeTargetId(note.id)}>
                                  Zusammenführen
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {readyNotes.length > 0 ? (
                  <div>
                    <p className="review-group-line">Bereit ({readyNotes.length})</p>
                    <ul className="review-list">
                      {readyNotes.map((note) => (
                        <li key={note.id}>
                          <div className="review-list-row">
                            <button
                              type="button"
                              className={
                                currentReviewNote?.id === note.id
                                  ? 'review-list-item review-list-item--active'
                                  : 'review-list-item'
                              }
                              onClick={() => setReviewCurrentId(note.id)}
                            >
                              <span>{toClockLabel(note.createdAt)}</span>
                              <span>{note.text}</span>
                              {mergeTargetId === note.id ? (
                                <span className="review-list-marker">Merging in diese Notiz</span>
                              ) : null}
                            </button>
                            <div className="review-row-actions">
                              {mergeTargetId === note.id ? (
                                <button type="button" onClick={() => setMergeTargetId(null)}>
                                  Merge beenden
                                </button>
                              ) : mergeTargetId ? (
                                <button type="button" onClick={() => void handleMergeIntoTarget(note.id)}>
                                  → hierhin zusammenführen
                                </button>
                              ) : (
                                <button type="button" onClick={() => setMergeTargetId(note.id)}>
                                  Zusammenführen
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {freshNotes.length > 0 ? (
                  <div>
                    <p className="review-group-line">Frisch ({freshNotes.length})</p>
                    <ul className="review-list">
                      {freshNotes.map((note) => (
                        <li key={note.id}>
                          <div className="review-list-row">
                            <button
                              type="button"
                              className={
                                currentReviewNote?.id === note.id
                                  ? 'review-list-item review-list-item--active'
                                  : 'review-list-item'
                              }
                              onClick={() => setReviewCurrentId(note.id)}
                            >
                              <span>{toClockLabel(note.createdAt)}</span>
                              <span>{note.text}</span>
                              <span className="review-list-badge">FRISCH</span>
                              {mergeTargetId === note.id ? (
                                <span className="review-list-marker">Merging in diese Notiz</span>
                              ) : null}
                            </button>
                            <div className="review-row-actions">
                              {mergeTargetId === note.id ? (
                                <button type="button" onClick={() => setMergeTargetId(null)}>
                                  Merge beenden
                                </button>
                              ) : mergeTargetId ? (
                                <button type="button" onClick={() => void handleMergeIntoTarget(note.id)}>
                                  → hierhin zusammenführen
                                </button>
                              ) : (
                                <button type="button" onClick={() => setMergeTargetId(note.id)}>
                                  Zusammenführen
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {hasMoreInboxNotes ? <p className="hint">Weitere Gedanken vorhanden</p> : null}

            {currentReviewNote ? (
              <>
                <p className="review-progress">
                  {reviewedCount} von {reviewTotal} Gedanken geprüft
                </p>
                <article className="review-card">
                  <p className="review-meta">
                    {currentReviewNote.dayISO} · {toClockLabel(currentReviewNote.createdAt)}
                  </p>
                  {isFreshNote(currentReviewNote) ? (
                    <p className="fresh-badge">
                      <strong>FRISCH</strong> <span>Gerade erfasst.</span>
                    </p>
                  ) : null}
                  <p className="review-text">{currentReviewNote.text}</p>
                  <div className="review-actions">
                    <button
                      type="button"
                      onClick={() => void handleReviewDecision(currentReviewNote.id, 'TODO')}
                    >
                      To-Do
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReviewDecision(currentReviewNote.id, 'PROCESS')}
                    >
                      Weiterdenken
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReviewDecision(currentReviewNote.id, 'DISCARD')}
                    >
                      Verwerfen
                    </button>
                    <button type="button" onClick={handleSkip}>
                      Überspringen
                    </button>
                  </div>
                </article>
              </>
            ) : null}

            <button
              type="button"
              className="section-toggle"
              onClick={() => setShowDecidedToday((prev) => !prev)}
              aria-expanded={showDecidedToday}
            >
              Heute entschieden ({todayDecidedNotes.length})
            </button>
            {showDecidedToday ? (
              todayDecidedNotes.length === 0 ? (
                <p className="empty-text">Heute noch nichts entschieden.</p>
              ) : (
                <ul className="notes-list" aria-label="Heute entschiedene Notizen">
                  {todayDecidedNotes.map((note) => (
                    <li key={note.id} className="note-item">
                      <span className="note-time">{toClockLabel(note.createdAt)}</span>
                      <div className="note-text">
                        <p className="review-status-line">
                          <span className={`status-badge status-badge--${note.status.toLowerCase()}`}>
                            {note.status}
                          </span>
                        </p>
                        <span>{note.text}</span>
                      </div>
                      <button
                        type="button"
                        className="note-delete"
                        onClick={() => void handleReturnToInbox(note.id)}
                      >
                        Zurück in Inbox
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </>
        )}

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  )
}
