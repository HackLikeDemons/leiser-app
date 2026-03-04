import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react'
import Fuse from 'fuse.js'
import {
  addNote,
  countInboxNotes,
  countNotesByStatus,
  deleteNote,
  listDecidedNotesByDay,
  listInboxNotes,
  listNotesByStatus,
  listRecentActiveNotes,
  listSearchableNotes,
  listTodoNotes,
  updateNoteStatus,
} from './lib/dbNotes'
import { buildBackupData, importBackupJson, type ImportMode, type ImportReport } from './lib/backup'
import { getLocalDayISO } from './lib/date'
import type { Note, NoteStatus, NoteType } from './lib/types'

type TabKey = 'BRAINDUMP' | 'REVIEW' | 'THINKING' | 'TODO'
const SOFT_CHAR_LIMIT = 200
const THEME_KEY = 'leiser:theme'
const SEARCH_RESULT_LIMIT = 50
const REVIEW_LIMIT = 50
const FRESH_HOURS = 12
const OVERDUE_DAYS = 3

type ReviewAgeCategory = 'OVERDUE' | 'READY' | 'FRESH'
type LastAction = {
  noteId: string
  prevStatus: NoteStatus
  newStatus: NoteStatus
  at: number
}

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

function noteStatusLabel(status: NoteStatus) {
  if (status === 'INBOX') return 'Inbox'
  if (status === 'TODO') return 'To-Do'
  if (status === 'PROCESS') return 'Denken'
  if (status === 'ARCHIVE') return 'Archiv'
  return 'Verworfen'
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function getReviewAgeCategory(note: Note): ReviewAgeCategory {
  const createdMs = Date.parse(note.createdAt)
  if (Number.isNaN(createdMs)) {
    return 'READY'
  }
  const ageMs = Date.now() - createdMs
  const freshMs = FRESH_HOURS * 60 * 60 * 1000
  const overdueMs = OVERDUE_DAYS * 24 * 60 * 60 * 1000
  if (ageMs >= overdueMs) return 'OVERDUE'
  if (ageMs < freshMs) return 'FRESH'
  return 'READY'
}

function reviewAgeLabel(category: ReviewAgeCategory) {
  if (category === 'OVERDUE') return 'Überfällig'
  if (category === 'READY') return 'Bereit'
  return 'Frisch'
}

function sortInboxForReview(notes: Note[]) {
  const overdue: Note[] = []
  const ready: Note[] = []
  const fresh: Note[] = []
  for (const note of notes) {
    const category = getReviewAgeCategory(note)
    if (category === 'OVERDUE') overdue.push(note)
    else if (category === 'READY') ready.push(note)
    else fresh.push(note)
  }
  const byOldest = (a: Note, b: Note) => a.createdAt.localeCompare(b.createdAt)
  overdue.sort(byOldest)
  ready.sort(byOldest)
  fresh.sort(byOldest)
  return [...overdue, ...ready, ...fresh]
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('BRAINDUMP')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' ? 'light' : 'dark'
  })
  const [text, setText] = useState('')
  const [braindumpNotes, setBraindumpNotes] = useState<Note[]>([])
  const [inboxNotes, setInboxNotes] = useState<Note[]>([])
  const [inboxCount, setInboxCount] = useState(0)
  const [decidedTodayNotes, setDecidedTodayNotes] = useState<Note[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null)
  const [showDecidedToday, setShowDecidedToday] = useState(false)
  const [processNotes, setProcessNotes] = useState<Note[]>([])
  const [processCount, setProcessCount] = useState(0)
  const [todoNotes, setTodoNotes] = useState<Note[]>([])
  const [archivedNotes, setArchivedNotes] = useState<Note[]>([])
  const [archiveCount, setArchiveCount] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchableNotes, setSearchableNotes] = useState<Note[]>([])
  const [showArchive, setShowArchive] = useState(false)
  const [showDataPanel, setShowDataPanel] = useState(false)
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('MERGE')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [error, setError] = useState('')
  const captureInputRef = useRef<HTMLTextAreaElement | null>(null)
  const undoTimeoutRef = useRef<number | null>(null)

  const todayISO = useMemo(() => getLocalDayISO(), [])
  const yesterdayISO = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return getLocalDayISO(d)
  }, [])

  const refreshAll = async () => {
    try {
      const [braindump, inbox, inboxTotal, decidedToday, process, processTotal, todo, archived, archivedTotal, searchable] = await Promise.all([
        listRecentActiveNotes(500),
        listInboxNotes(REVIEW_LIMIT),
        countInboxNotes(),
        listDecidedNotesByDay(todayISO, 200),
        listNotesByStatus('PROCESS', 200),
        countNotesByStatus('PROCESS'),
        listTodoNotes(200),
        listNotesByStatus('ARCHIVE', 50),
        countNotesByStatus('ARCHIVE'),
        listSearchableNotes(),
      ])
      setBraindumpNotes(braindump)
      setInboxNotes(inbox)
      setInboxCount(inboxTotal)
      setDecidedTodayNotes(decidedToday)
      setProcessNotes(process)
      setProcessCount(processTotal)
      setTodoNotes(todo)
      setArchivedNotes(archived)
      setArchiveCount(archivedTotal)
      setSearchableNotes(searchable)
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

  const orderedInbox = useMemo(() => sortInboxForReview(inboxNotes), [inboxNotes])
  const pinnedReviewIndex = useMemo(() => {
    if (!currentNoteId) {
      return -1
    }
    return orderedInbox.findIndex((note) => note.id === currentNoteId)
  }, [currentNoteId, orderedInbox])
  const effectiveReviewIndex = pinnedReviewIndex >= 0 ? pinnedReviewIndex : reviewIndex

  useEffect(() => {
    if (orderedInbox.length === 0) {
      setReviewIndex(0)
      setCurrentNoteId(null)
      return
    }
    if (reviewIndex >= orderedInbox.length) {
      setReviewIndex(orderedInbox.length - 1)
    }
  }, [orderedInbox, reviewIndex])

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

  const clearUndoTimeout = () => {
    if (undoTimeoutRef.current !== null) {
      window.clearTimeout(undoTimeoutRef.current)
      undoTimeoutRef.current = null
    }
  }

  useEffect(() => () => clearUndoTimeout(), [])

  const startUndoWindow = (action: LastAction) => {
    clearUndoTimeout()
    setLastAction(action)
    undoTimeoutRef.current = window.setTimeout(() => {
      setLastAction((current) => {
        if (!current) return null
        if (current.noteId !== action.noteId || current.at !== action.at) {
          return current
        }
        return null
      })
      undoTimeoutRef.current = null
    }, 8000)
  }

  const handleReviewDecision = async (
    id: string,
    status: NoteStatus,
    options?: { enableUndo?: boolean; sourceNote?: Note | null },
  ) => {
    setError('')
    try {
      if (options?.enableUndo) {
        const snapshot = options.sourceNote
        if (snapshot) {
          startUndoWindow({
            noteId: snapshot.id,
            prevStatus: snapshot.status,
            newStatus: status,
            at: Date.now(),
          })
        }
      }
      await updateNoteStatus(id, status)
      await refreshAll()
    } catch {
      if (options?.enableUndo) {
        clearUndoTimeout()
        setLastAction(null)
      }
      setError('Status konnte nicht aktualisiert werden.')
    }
  }

  const handleUndoLastReviewAction = async () => {
    if (!lastAction || undoBusy) {
      return
    }

    setUndoBusy(true)
    setError('')
    try {
      await updateNoteStatus(lastAction.noteId, lastAction.prevStatus)
      setCurrentNoteId(lastAction.noteId)
      clearUndoTimeout()
      setLastAction(null)
      await refreshAll()
    } catch {
      setError('Rückgängig fehlgeschlagen.')
    } finally {
      setUndoBusy(false)
    }
  }

  const handleSkipReview = () => {
    if (orderedInbox.length <= 1) {
      return
    }
    setCurrentNoteId(null)
    setReviewIndex((effectiveReviewIndex + 1) % orderedInbox.length)
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

  const isSearchMode = searchQuery.trim().length > 0
  const currentReviewNote = orderedInbox[effectiveReviewIndex] ?? null
  const currentReviewCategory = currentReviewNote ? getReviewAgeCategory(currentReviewNote) : null
  const braindumpGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; notes: Note[] }> = []
    for (const note of braindumpNotes) {
      const dayISO = note.dayISO
      let label = dayISO
      if (dayISO === todayISO) {
        label = 'Heute'
      } else if (dayISO === yesterdayISO) {
        label = 'Gestern'
      }

      const last = groups[groups.length - 1]
      if (last && last.key === dayISO) {
        last.notes.push(note)
      } else {
        groups.push({ key: dayISO, label, notes: [note] })
      }
    }
    return groups
  }, [braindumpNotes, todayISO, yesterdayISO])

  const searchEngine = useMemo(
    () =>
      new Fuse(searchableNotes, {
        keys: ['text'],
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [searchableNotes],
  )

  const searchResults = useMemo(() => {
    if (!isSearchMode) {
      return []
    }
    return searchEngine.search(searchQuery.trim(), { limit: SEARCH_RESULT_LIMIT })
  }, [isSearchMode, searchEngine, searchQuery])

  useEffect(() => {
    if (activeTab !== 'BRAINDUMP' || isSearchMode) {
      return
    }

    const focusInput = () => {
      captureInputRef.current?.focus({ preventScroll: true })
    }

    const frameId = requestAnimationFrame(focusInput)
    window.addEventListener('focus', focusInput)
    document.addEventListener('visibilitychange', focusInput)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('focus', focusInput)
      document.removeEventListener('visibilitychange', focusInput)
    }
  }, [activeTab, isSearchMode, braindumpNotes.length])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (activeTab !== 'REVIEW' || isSearchMode) return
      if (isTypingTarget(event.target)) return
      if (!currentReviewNote && event.key.toLowerCase() !== 'escape') return

      const key = event.key.toLowerCase()
      if (key === 't' && currentReviewNote) {
        event.preventDefault()
        void handleReviewDecision(currentReviewNote.id, 'TODO', { enableUndo: true, sourceNote: currentReviewNote })
      } else if (key === 'p' && currentReviewNote) {
        event.preventDefault()
        void handleReviewDecision(currentReviewNote.id, 'PROCESS', { enableUndo: true, sourceNote: currentReviewNote })
      } else if (key === 'd' && currentReviewNote) {
        event.preventDefault()
        void handleReviewDecision(currentReviewNote.id, 'DISCARD', { enableUndo: true, sourceNote: currentReviewNote })
      } else if (key === 's' && currentReviewNote) {
        event.preventDefault()
        handleSkipReview()
      } else if (key === 'escape') {
        event.preventDefault()
        setShowDecidedToday(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTab, currentReviewNote, isSearchMode, orderedInbox.length])

  return (
    <main className="daily-shell">
      <section className="daily-card">
        <header className="app-header">
          {!isSearchMode ? (
            <div className="mode-tabs" role="tablist" aria-label="Bereiche">
            <button
              type="button"
              className={activeTab === 'BRAINDUMP' ? 'tab-button tab-button--active' : 'tab-button'}
              onClick={() => setActiveTab('BRAINDUMP')}
              aria-label="Braindump"
              title="Braindump"
            >
              Braindump
            </button>
            <button
              type="button"
              className={activeTab === 'REVIEW' ? 'tab-button tab-button--active' : 'tab-button'}
              onClick={() => setActiveTab('REVIEW')}
              aria-label="Review"
              title="Review"
            >
              Review
            </button>
            <button
              type="button"
              className={activeTab === 'THINKING' ? 'tab-button tab-button--active' : 'tab-button'}
              onClick={() => setActiveTab('THINKING')}
              aria-label="Denken"
              title="Denken"
            >
              Denken
            </button>
            <button
              type="button"
              className={activeTab === 'TODO' ? 'tab-button tab-button--active' : 'tab-button'}
              onClick={() => setActiveTab('TODO')}
              aria-label="To-Do"
              title="To-Do"
            >
              To-Do
            </button>
            </div>
          ) : null}

          <div className="header-search">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Suche Gedanken..."
              aria-label="Suche Gedanken"
            />
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

        <div className="tab-content">
          {isSearchMode ? (
            <>
              <h2>Treffer ({searchResults.length})</h2>
              {searchResults.length === 0 ? <p className="empty-text">Keine passenden Gedanken gefunden.</p> : null}
              <ul className="notes-list" aria-label="Suchtreffer">
                {searchResults.map((result) => {
                  const note = result.item
                  return (
                    <li key={note.id} className="note-item note-item--todo">
                      <span className="note-time">{toClockLabel(note.createdAt)}</span>
                      <span className="note-content">
                        <span className="note-text">{note.text}</span>
                        <span className="status-badge">{noteStatusLabel(note.status)}</span>
                        {renderTypeBadge(note)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
          {!isSearchMode ? (
            <>
          {activeTab === 'BRAINDUMP' ? (
            <>
            <form className="capture-form" onSubmit={(event) => void handleSubmit(event)}>
              <textarea
                rows={2}
                ref={captureInputRef}
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

            {braindumpGroups.length === 0 ? <p className="empty-text">Noch keine Notizen.</p> : null}
            {braindumpGroups.map((group) => (
              <section key={group.key} className="note-group">
                <h3 className="note-group-title">
                  {group.label} ({group.notes.length})
                </h3>
                <ul className="notes-list" aria-label={`${group.label} Notizen`}>
                  {group.notes.map((note) => (
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
                            className="note-delete note-delete--icon"
                            onClick={() => void handleDelete(note.id, { confirm: false })}
                            aria-label="Rückgängig"
                            title="Rückgängig"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M9 7 4 12l5 5M5 12h8a5 5 0 1 1 0 10h-2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
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
              </section>
            ))}
            </>
          ) : null}

          {activeTab === 'REVIEW' ? (
            <>
              <h2>Review</h2>
              {currentReviewNote ? (
                <article className="review-focus-card" aria-label="Aktueller Gedanke">
                  <div className="review-focus-head">
                    <span className="note-time">{toClockLabel(currentReviewNote.createdAt)}</span>
                    <span className={`age-badge age-badge--${currentReviewCategory?.toLowerCase()}`}>
                      {reviewAgeLabel(currentReviewCategory ?? 'READY')}
                    </span>
                  </div>
                  <div className="review-focus-text">
                    <span className="note-text">{currentReviewNote.text}</span>
                    {renderTypeBadge(currentReviewNote)}
                  </div>
                  <div className="review-actions-inline">
                    <button
                      type="button"
                      className="review-btn review-btn--todo"
                      onClick={() =>
                        void handleReviewDecision(currentReviewNote.id, 'TODO', {
                          enableUndo: true,
                          sourceNote: currentReviewNote,
                        })
                      }
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M9 7h10M9 12h10M9 17h10M4 7h.01M4 12h.01M4 17h.01"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      To-Do
                    </button>
                    <button
                      type="button"
                      className="review-btn review-btn--process"
                      onClick={() =>
                        void handleReviewDecision(currentReviewNote.id, 'PROCESS', {
                          enableUndo: true,
                          sourceNote: currentReviewNote,
                        })
                      }
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M12 4c-1.8 0-3.3 1-4 2.6a3.6 3.6 0 0 0-2.9 3.5c0 .9.3 1.7.9 2.4-.3.5-.4 1-.4 1.6 0 1.7 1.3 3 3 3h1.2V20h4.6v-2.9H16a3 3 0 0 0 3-3c0-.6-.2-1.1-.4-1.6.5-.7.8-1.5.8-2.4a3.6 3.6 0 0 0-2.9-3.5A4.4 4.4 0 0 0 12 4Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M10.5 8.8c.7.8.7 2 0 2.8m3-2.8c.7.8.7 2 0 2.8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                      Denken
                    </button>
                    <button
                      type="button"
                      className="review-btn review-btn--discard"
                      onClick={() =>
                        void handleReviewDecision(currentReviewNote.id, 'DISCARD', {
                          enableUndo: true,
                          sourceNote: currentReviewNote,
                        })
                      }
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
                      Verwerfen
                    </button>
                    <button type="button" className="review-btn review-btn--skip" onClick={handleSkipReview}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M5 12h12m0 0-4-4m4 4-4 4M19 7v10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Überspringen
                    </button>
                  </div>
                  <p className="review-meta">
                    Kategorie: {reviewAgeLabel(currentReviewCategory ?? 'READY')} ·{' '}
                    {Math.min(effectiveReviewIndex + 1, orderedInbox.length)} von {inboxCount} offen
                  </p>
                  {inboxCount > inboxNotes.length ? (
                    <p className="hint">Weitere offene Gedanken vorhanden.</p>
                  ) : null}
                </article>
              ) : (
                <p className="empty-text">Keine offenen Gedanken.</p>
              )}

              {lastAction ? (
                <div className="undo-snackbar" role="status" aria-live="polite">
                  <span>Gespeichert.</span>
                  <button type="button" onClick={() => void handleUndoLastReviewAction()} disabled={undoBusy}>
                    Rückgängig
                  </button>
                </div>
              ) : null}

              <section className="decided-section">
                <button
                  type="button"
                  className="decided-toggle"
                  onClick={() => setShowDecidedToday((prev) => !prev)}
                >
                  Heute entschieden ({decidedTodayNotes.length})
                </button>
                {showDecidedToday ? (
                  <>
                    {decidedTodayNotes.length === 0 ? (
                      <p className="empty-text">Heute noch nichts entschieden.</p>
                    ) : (
                      <ul className="notes-list" aria-label="Heute entschiedene Gedanken">
                        {decidedTodayNotes.map((note) => (
                          <li key={note.id} className="note-item note-item--todo">
                            <span className="note-time">{toClockLabel(note.createdAt)}</span>
                            <span className="note-content">
                              <span className="note-text">{note.text}</span>
                              <span className="status-badge">{noteStatusLabel(note.status)}</span>
                              {renderTypeBadge(note)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : null}
              </section>
            </>
          ) : null}

          {activeTab === 'THINKING' ? (
            <>
            <div className="section-headline">
              <h2>Denken ({processCount})</h2>
              <button
                type="button"
                className="archive-toggle"
                onClick={() => setShowArchive((prev) => !prev)}
              >
                {showArchive ? `Archiv ausblenden (${archiveCount})` : `Archiv anzeigen (${archiveCount})`}
              </button>
            </div>
            {processCount === 0 ? <p className="empty-text">Keine offenen Gedanken im Denken.</p> : null}
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
                      className="review-btn review-btn--archive review-btn--icon"
                      onClick={() => void handleReviewDecision(note.id, 'ARCHIVE')}
                      aria-label="Archivieren"
                      title="Archivieren"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M3 7h18v4H3V7Zm3 4h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8Zm4 3h4"
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
                      className="review-btn review-btn--todo review-btn--icon"
                      onClick={() => void handleReviewDecision(note.id, 'TODO')}
                      aria-label="Zu To-Do verschieben"
                      title="Zu To-Do"
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
                    </button>
                    <button
                      type="button"
                      className="review-btn review-btn--discard review-btn--icon"
                      onClick={() => void handleReviewDecision(note.id, 'DISCARD')}
                      aria-label="Verwerfen"
                      title="Verwerfen"
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
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {showArchive ? (
              <>
                <h3 className="archive-title">Archiv</h3>
                {archivedNotes.length === 0 ? <p className="empty-text">Archiv ist leer.</p> : null}
                <ul className="notes-list" aria-label="Archivierte Gedanken">
                  {archivedNotes.map((note) => (
                    <li key={note.id} className="note-item note-item--todo">
                      <span className="note-time">{note.createdAt.slice(0, 10)}</span>
                      <span className="note-content">
                        <span className="note-text">{note.text}</span>
                        {renderTypeBadge(note)}
                      </span>
                      <div className="todo-actions">
                        <button
                          type="button"
                          className="review-btn review-btn--back review-btn--icon"
                          onClick={() => void handleReviewDecision(note.id, 'PROCESS')}
                          aria-label="Weiterdenken"
                          title="Weiterdenken"
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
                        <button
                          type="button"
                          className="review-btn review-btn--discard review-btn--icon"
                          onClick={() => void handleReviewDecision(note.id, 'DISCARD')}
                          aria-label="Verwerfen"
                          title="Verwerfen"
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
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {archiveCount > archivedNotes.length ? (
                  <p className="hint">Nur die letzten 50 angezeigt.</p>
                ) : null}
              </>
            ) : null}
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
            </>
          ) : null}
        </div>
      </section>
    </main>
  )
}
