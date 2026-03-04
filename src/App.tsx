import { useEffect, useMemo, useState } from 'react'
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react'
import {
  addNote,
  deleteNote,
  listInboxNotes,
  listNotesByDay,
  listProcessNotes,
  updateNoteText,
  updateNoteStatus,
} from './lib/dbNotes'
import { getLocalDayISO } from './lib/date'
import type { Note, NoteStatus } from './lib/types'

type TabKey = 'BRAINDUMP' | 'REVIEW' | 'THINKING'
const SOFT_CHAR_LIMIT = 200

function toClockLabel(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function isUndoAvailable(note: Note) {
  const createdMs = Date.parse(note.createdAt)
  if (Number.isNaN(createdMs)) {
    return false
  }
  return Date.now() - createdMs <= 5000
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('BRAINDUMP')
  const [text, setText] = useState('')
  const [todayNotes, setTodayNotes] = useState<Note[]>([])
  const [inboxNotes, setInboxNotes] = useState<Note[]>([])
  const [processNotes, setProcessNotes] = useState<Note[]>([])
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
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

  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text')
    if (!pasted.includes('\n')) {
      return
    }

    event.preventDefault()
    const lines = pasted
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (lines.length === 0) {
      return
    }

    setError('')
    try {
      await Promise.all(lines.map((line) => addNote(line)))
      setText('')
      await refreshAll()
    } catch {
      setError('Notizen aus Zwischenablage konnten nicht gespeichert werden.')
    }
  }

  const handleDelete = async (id: string, options?: { confirm?: boolean }) => {
    const shouldConfirm = options?.confirm ?? true
    if (shouldConfirm) {
      const confirmed = window.confirm('Notiz löschen?')
      if (!confirmed) {
        return
      }
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

  const handleMergeIntoTarget = async (sourceId: string) => {
    if (!mergeTargetId || mergeTargetId === sourceId) {
      return
    }

    const target = inboxNotes.find((note) => note.id === mergeTargetId)
    const source = inboxNotes.find((note) => note.id === sourceId)
    if (!target || !source) {
      return
    }

    setError('')
    try {
      await updateNoteText(target.id, `${target.text}\n\n${source.text}`)
      await deleteNote(source.id)
      setMergeTargetId(null)
      await refreshAll()
    } catch {
      setError('Zusammenführen fehlgeschlagen.')
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
                onPaste={(event) => void handlePaste(event)}
              />
              <div className="capture-meta">
                <small className={text.length > SOFT_CHAR_LIMIT ? 'counter counter--warning' : 'counter'}>
                  {text.length} / {SOFT_CHAR_LIMIT}
                </small>
                {text.length > SOFT_CHAR_LIMIT ? (
                  <small className="soft-limit-hint">Vielleicht sind das mehrere Gedanken.</small>
                ) : null}
              </div>
              <button type="submit">Hinzufügen</button>
            </form>

            <h2>Heute</h2>
            {todayNotes.length === 0 ? <p className="empty-text">Noch keine Notizen heute.</p> : null}
            <ul className="notes-list" aria-label="Heutige Notizen">
              {todayNotes.map((note) => (
                <li key={note.id} className="note-item">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-text">{note.text}</span>
                  <div className="note-actions">
                    {isUndoAvailable(note) ? (
                      <button
                        type="button"
                        className="note-delete"
                        onClick={() => void handleDelete(note.id, { confirm: false })}
                      >
                        Rückgängig
                      </button>
                    ) : null}
                    <button type="button" className="note-delete" onClick={() => void handleDelete(note.id)}>
                      Löschen
                    </button>
                  </div>
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
                    {mergeTargetId === note.id ? (
                      <span className="merge-label">Merging in diese Notiz</span>
                    ) : null}
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
