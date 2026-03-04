import { useEffect, useMemo, useState } from 'react'
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react'
import {
  addNote,
  deleteNote,
  listInboxNotes,
  listNotesByDay,
  listProcessNotes,
  listTodoNotes,
  updateNoteText,
  updateNoteStatus,
} from './lib/dbNotes'
import { buildBackupData, importBackupJson, type ImportMode, type ImportReport } from './lib/backup'
import { getLocalDayISO } from './lib/date'
import type { Note, NoteStatus, NoteType } from './lib/types'

type TabKey = 'BRAINDUMP' | 'REVIEW' | 'THINKING' | 'TODO'
const SOFT_CHAR_LIMIT = 200
const THEME_KEY = 'leiser:theme'

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

function noteTypeLabel(type: NoteType) {
  if (type === 'QUESTION') {
    return '? Frage'
  }
  if (type === 'IDEA') {
    return 'Idee'
  }
  if (type === 'TASK') {
    return 'Aufgabe'
  }
  return null
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('BRAINDUMP')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' ? 'light' : 'dark'
  })
  const [text, setText] = useState('')
  const [todayNotes, setTodayNotes] = useState<Note[]>([])
  const [inboxNotes, setInboxNotes] = useState<Note[]>([])
  const [processNotes, setProcessNotes] = useState<Note[]>([])
  const [todoNotes, setTodoNotes] = useState<Note[]>([])
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
  const [showDataPanel, setShowDataPanel] = useState(false)
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('MERGE')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState('')

  const todayISO = useMemo(() => getLocalDayISO(), [])

  const refreshAll = async () => {
    try {
      const [today, inbox, process, todo] = await Promise.all([
        listNotesByDay(todayISO, 500),
        listInboxNotes(200),
        listProcessNotes(200),
        listTodoNotes(200),
      ])
      setTodayNotes(today)
      setInboxNotes(inbox)
      setProcessNotes(process)
      setTodoNotes(todo)
    } catch {
      setError('Daten konnten nicht geladen werden.')
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [todayISO])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

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

  const handleReviewDecision = async (id: string, status: NoteStatus) => {
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

  const handleExport = async () => {
    setError('')
    try {
      const backup = await buildBackupData()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const day = getLocalDayISO()
      link.href = url
      link.download = `leiser-backup-${day}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Backup konnte nicht exportiert werden.')
    }
  }

  const handleImport = async () => {
    if (!importFile) {
      setError('Bitte zuerst eine Backup-Datei auswählen.')
      return
    }

    setError('')
    setImportReport(null)
    try {
      const fileText = await importFile.text()
      const report = await importBackupJson(fileText, importMode)
      setImportReport(report)
      setImportFile(null)
      await refreshAll()
    } catch (importError) {
      if (importError instanceof Error) {
        setError(importError.message)
      } else {
        setError('Import fehlgeschlagen.')
      }
    }
  }

  const renderTypeBadge = (note: Note) => {
    const label = noteTypeLabel(note.type)
    if (!label) {
      return null
    }
    return <span className="note-type-badge">{label}</span>
  }

  return (
    <main className="daily-shell">
      <section className="daily-card">
        <header className="app-header">
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
            <button
              type="button"
              className={activeTab === 'TODO' ? 'tab-button tab-button--active' : 'tab-button'}
              onClick={() => setActiveTab('TODO')}
            >
              To-Do
            </button>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowDataPanel((prev) => !prev)}
              aria-label="Backup-Menü öffnen"
              title="Backup"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 3v9m0 0 3-3m-3 3-3-3M4 14.5v4A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Zum hellen Theme wechseln' : 'Zum dunklen Theme wechseln'}
              title={theme === 'dark' ? 'Helles Theme' : 'Dunkles Theme'}
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 4.5V2m0 20v-2.5M4.5 12H2m20 0h-2.5M6.34 6.34L4.57 4.57m14.86 14.86-1.77-1.77M17.66 6.34l1.77-1.77M6.34 17.66l-1.77 1.77M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M21 12.8A8.8 8.8 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </header>

        {showDataPanel ? (
          <section className="data-section" aria-label="Daten">
            <div className="data-panel">
              <div className="data-actions">
                <button type="button" onClick={() => void handleExport()}>
                  Backup exportieren
                </button>
                <button type="button" onClick={() => setShowImportPanel((prev) => !prev)}>
                  Backup importieren
                </button>
              </div>

              {showImportPanel ? (
                <div className="import-panel">
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                  />
                  <label className="import-mode-option">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'MERGE'}
                      onChange={() => setImportMode('MERGE')}
                    />
                    <span>Zusammenführen (empfohlen)</span>
                  </label>
                  <label className="import-mode-option">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'REPLACE'}
                      onChange={() => setImportMode('REPLACE')}
                    />
                    <span>Ersetzen (löscht lokale Daten)</span>
                  </label>
                  <button type="button" onClick={() => void handleImport()}>
                    Import starten
                  </button>
                </div>
              ) : null}

              {importReport ? (
                <p className="hint">
                  Importiert: {importReport.imported} · Aktualisiert: {importReport.updated} · Übersprungen:{' '}
                  {importReport.skipped} · Ungültig: {importReport.invalid}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === 'BRAINDUMP' ? (
          <>
            <form className="capture-form" onSubmit={(event) => void handleSubmit(event)}>
              <textarea
                rows={2}
                placeholder="Gedanken festhalten..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleTextKeyDown}
                onPaste={(event) => void handlePaste(event)}
              />
              <small className="capture-hint">Enter speichert, Shift+Enter macht einen Zeilenumbruch.</small>
              <div className="capture-actions">
                <div className="capture-meta">
                  <small className={text.length > SOFT_CHAR_LIMIT ? 'counter counter--warning' : 'counter'}>
                    {text.length} / {SOFT_CHAR_LIMIT}
                  </small>
                  {text.length > SOFT_CHAR_LIMIT ? (
                    <small className="soft-limit-hint">Vielleicht sind das mehrere Gedanken.</small>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="capture-submit"
                  aria-label="Notiz hinzufügen"
                  title="Hinzufügen"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 5v14M5 12h14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </form>

            <h2>Heute ({todayNotes.length})</h2>
            {todayNotes.length === 0 ? <p className="empty-text">Noch keine Notizen heute.</p> : null}
            <ul className="notes-list" aria-label="Heutige Notizen">
              {todayNotes.map((note) => (
                <li key={note.id} className="note-item">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-content">
                    <span className="note-text">{note.text}</span>
                    {renderTypeBadge(note)}
                  </span>
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
                    <button
                      type="button"
                      className="note-delete note-delete--icon"
                      onClick={() => void handleDelete(note.id)}
                      aria-label="Notiz löschen"
                      title="Löschen"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M4 7h16M9.5 3h5M8 7v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7M10 11v6M14 11v6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {activeTab === 'REVIEW' ? (
          <>
            <h2>Offen ({inboxNotes.length})</h2>
            {inboxNotes.length === 0 ? <p className="empty-text">Keine offenen Gedanken.</p> : null}
            <ul className="notes-list" aria-label="Offene Gedanken">
              {inboxNotes.map((note) => (
                <li key={note.id} className="note-item note-item--review">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-content">
                    <span className="note-text">{note.text}</span>
                    {renderTypeBadge(note)}
                  </span>
                  <div className="review-actions-inline">
                    <button
                      type="button"
                      className="review-btn review-btn--todo"
                      onClick={() => void handleReviewDecision(note.id, 'TODO')}
                    >
                      <span aria-hidden="true">✓</span>
                      <span>TODO</span>
                    </button>
                    <button
                      type="button"
                      className="review-btn review-btn--process"
                      onClick={() => void handleReviewDecision(note.id, 'PROCESS')}
                    >
                      <span aria-hidden="true">◎</span>
                      <span>PROCESS</span>
                    </button>
                    <button
                      type="button"
                      className="review-btn review-btn--discard"
                      onClick={() => void handleReviewDecision(note.id, 'DISCARD')}
                    >
                      <span aria-hidden="true">×</span>
                      <span>DISCARD</span>
                    </button>
                    {mergeTargetId === note.id ? (
                      <button type="button" className="review-btn review-btn--merge" onClick={() => setMergeTargetId(null)}>
                        Merge beenden
                      </button>
                    ) : mergeTargetId ? (
                      <button
                        type="button"
                        className="review-btn review-btn--merge"
                        onClick={() => void handleMergeIntoTarget(note.id)}
                      >
                        → hierhin zusammenführen
                      </button>
                    ) : (
                      <button type="button" className="review-btn review-btn--merge" onClick={() => setMergeTargetId(note.id)}>
                        Zusammenführen
                      </button>
                    )}
                    {mergeTargetId === note.id ? <span className="merge-label">Merging in diese Notiz</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {activeTab === 'THINKING' ? (
          <>
            <h2>Denken ({processNotes.length})</h2>
            {processNotes.length === 0 ? <p className="empty-text">Keine Gedanken im Denken-Modus.</p> : null}
            <ul className="notes-list" aria-label="Denken Notizen">
              {processNotes.map((note) => (
                <li key={note.id} className="note-item">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-content">
                    <span className="note-text">{note.text}</span>
                    {renderTypeBadge(note)}
                  </span>
                  <div className="note-actions">
                    <button
                      type="button"
                      className="review-btn review-btn--archive"
                      onClick={() => void handleReviewDecision(note.id, 'ARCHIVE')}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M4 8h16M6 8v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8M9 4h6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span>Abgelegt</span>
                    </button>
                    <button
                      type="button"
                      className="review-btn review-btn--todo"
                      onClick={() => void handleReviewDecision(note.id, 'TODO')}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M9 7h10M9 12h10M9 17h10M4 7h.01M4 12h.01M4 17h.01"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span>To-Do</span>
                    </button>
                    <button
                      type="button"
                      className="review-btn review-btn--discard"
                      onClick={() => void handleReviewDecision(note.id, 'DISCARD')}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M6 6l12 12M18 6 6 18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span>Verwerfen</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {activeTab === 'TODO' ? (
          <>
            <h2>To-Do ({todoNotes.length})</h2>
            {todoNotes.length === 0 ? <p className="empty-text">Keine offenen To-Dos.</p> : null}
            <ul className="notes-list" aria-label="To-Do Notizen">
              {todoNotes.map((note) => (
                <li key={note.id} className="note-item note-item--todo">
                  <span className="note-time">{toClockLabel(note.createdAt)}</span>
                  <span className="note-content">
                    <span className="note-text">{note.text}</span>
                    {renderTypeBadge(note)}
                  </span>
                  <div className="todo-actions">
                    <button
                      type="button"
                      className="review-btn review-btn--done review-btn--icon"
                      onClick={() => void handleReviewDecision(note.id, 'DISCARD')}
                      aria-label="Als erledigt markieren"
                      title="Erledigt"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M5 12.5 10 17l9-10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="review-btn review-btn--back review-btn--icon"
                      onClick={() => void handleReviewDecision(note.id, 'INBOX')}
                      aria-label="Zurück in Inbox"
                      title="Zurück"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M10 7 5 12l5 5M6 12h13"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
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
