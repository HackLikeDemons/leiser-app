import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent, KeyboardEvent, RefObject } from 'react'
import Fuse from 'fuse.js'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  DEFAULT_SYNC_ROOM_ID,
  addNote,
  countInboxNotes,
  countNotesByStatus,
  deleteNote,
  getSyncDebugInfo,
  getSyncPairCode,
  listDecidedNotesByDay,
  listInboxNotes,
  listNotesByStatus,
  listRecentActiveNotes,
  listSearchableNotes,
  listTodoNotes,
  setSyncEnabled,
  updateNoteStatus,
} from './lib/dbNotes'
import { buildBackupData, importBackupJson, type ImportMode, type ImportReport } from './lib/backup'
import { getLocalDayISO } from './lib/date'
import type { Note, NoteStatus, NoteType } from './lib/types'
import { AppShell } from './app/AppShell'
import { FooterProvider, useFooter } from './app/FooterContext'
import { seedOlderThoughtsDemo } from './lib/demoNotes'
import { startSyncEngine, syncNow, type SyncUiStatus } from './lib/syncEngine'

type TabKey = 'BRAINDUMP' | 'REVIEW' | 'THINKING' | 'TODO' | 'DATA'
const SOFT_CHAR_LIMIT = 200
const THEME_KEY = 'leiser:theme'
const SEARCH_RESULT_LIMIT = 50
const REVIEW_LIMIT = 50
const FRESH_HOURS = 12
const OVERDUE_DAYS = 3
const AUTOSCROLL_NEAR_BOTTOM_PX = 80
const BRAINDUMP_FETCH_LIMIT = 300

type ReviewAgeCategory = 'OVERDUE' | 'READY' | 'FRESH'
type LastAction = {
  noteId: string
  prevStatus: NoteStatus
  newStatus: NoteStatus
  at: number
}
type NoteActionItem = {
  label: string
  onSelect: () => void
  destructive?: boolean
}

type DevSyncInfo = {
  deviceId: string
  roomId: string
  lastPulledSeq: number
  lastPushedAt: string | null
  isEnabled: boolean
  syncToken: string | null
}

function toClockLabel(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function toDayClockLabel(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}. · ${toClockLabel(isoTimestamp)}`
}

function toSyncTimeLabel(isoTimestamp: string | null) {
  if (!isoTimestamp) {
    return 'noch keiner'
  }
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) {
    return 'noch keiner'
  }
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatNoteTime(note: Note, todayISO: string) {
  if (note.dayISO === todayISO) {
    return toClockLabel(note.createdAt)
  }
  return toDayClockLabel(note.createdAt)
}

function daysBetween(dateA: Date, dateB: Date) {
  const a = new Date(dateA)
  const b = new Date(dateB)
  a.setHours(12, 0, 0, 0)
  b.setHours(12, 0, 0, 0)
  const diffMs = Math.abs(a.getTime() - b.getTime())
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
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
    return 'Frage'
  }
  if (type === 'IDEA') {
    return 'Idee'
  }
  if (type === 'TASK') {
    return 'Aufgabe'
  }
  return null
}

function NoteTypeBadge({ note }: { note: Note }) {
  const label = noteTypeLabel(note.type)
  if (!label) {
    return null
  }
  return <span className="note-type-badge">{label}</span>
}

function noteStatusLabel(status: NoteStatus) {
  if (status === 'INBOX') return 'Inbox'
  if (status === 'TODO') return 'To-Do'
  if (status === 'PROCESS') return 'Denken'
  if (status === 'ARCHIVE') return 'Archiv'
  return 'Verworfen'
}

function todoActionLabel(status: NoteStatus) {
  if (status === 'DISCARD') return 'Als erledigt markiert.'
  if (status === 'INBOX') return 'Zurück in Inbox verschoben.'
  return 'To-Do aktualisiert.'
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

function getDayDividerLabel(dayISO: string, todayISO: string, yesterdayISO: string) {
  if (dayISO === todayISO) return 'Heute'
  if (dayISO === yesterdayISO) return 'Gestern'
  return dayISO
}

const BraindumpNoteRow = memo(function BraindumpNoteRow({
  note,
  onUndoDelete,
  onDelete,
}: {
  note: Note
  onUndoDelete: (id: string) => void
  onDelete: (id: string) => void
}) {
  const label = noteTypeLabel(note.type)

  return (
    <li className="note-item">
      <span className="note-time">{toClockLabel(note.createdAt)}</span>
      <span className="note-content">
        <span className="note-text">{note.text}</span>
        {label ? <span className="note-type-badge">{label}</span> : null}
      </span>
      <div className="note-actions">
        {isUndoAvailable(note) ? (
          <button
            type="button"
            className="note-delete note-delete--icon"
            onClick={() => onUndoDelete(note.id)}
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
          onClick={() => onDelete(note.id)}
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
  )
})

const BraindumpList = memo(function BraindumpList({
  groups,
  onUndoDelete,
  onDelete,
  endRef,
}: {
  groups: Array<{ dayISO: string; label: string; notes: Note[] }>
  onUndoDelete: (id: string) => void
  onDelete: (id: string) => void
  endRef: RefObject<HTMLDivElement | null>
}) {
  if (groups.length === 0) {
    return <p className="empty-text">Noch keine Notizen.</p>
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.dayISO} className="note-group">
          <div className="day-divider">{group.label}</div>
          <ul className="notes-list" aria-label={`${group.label} Notizen`}>
            {group.notes.map((note) => (
              <BraindumpNoteRow
                key={note.id}
                note={note}
                onUndoDelete={onUndoDelete}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ))}
      <div ref={endRef} />
    </>
  )
})

function NoteActionsMenu({
  menuId,
  isOpen,
  onToggle,
  onClose,
  items,
}: {
  menuId: string
  isOpen: boolean
  onToggle: (menuId: string) => void
  onClose: () => void
  items: NoteActionItem[]
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, onClose])

  return (
    <div className="note-actions-menu" ref={menuRef}>
      <button
        type="button"
        className="note-actions-trigger review-btn review-btn--icon"
        aria-label="Aktionen"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => onToggle(menuId)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"
            fill="currentColor"
          />
        </svg>
      </button>
      {isOpen ? (
        <div className="note-actions-dropdown" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.destructive ? 'note-actions-item note-actions-item--destructive' : 'note-actions-item'}
              onClick={() => {
                item.onSelect()
                onClose()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TodoNoteRow({
  note,
  todayISO,
  onDone,
  onBack,
}: {
  note: Note
  todayISO: string
  onDone: (id: string) => void
  onBack: (id: string) => void
}) {
  return (
    <li key={note.id} className="note-item note-item--todo">
      <span className="note-time">{formatNoteTime(note, todayISO)}</span>
      <span className="note-content">
        <span className="note-text">{note.text}</span>
        <NoteTypeBadge note={note} />
      </span>
      <div className="todo-actions">
        <button
          type="button"
          className="review-btn review-btn--done review-btn--icon"
          onClick={() => onDone(note.id)}
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
          onClick={() => onBack(note.id)}
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
  )
}

function ThinkingNoteRow({
  note,
  onArchive,
  onTodo,
  onDiscard,
}: {
  note: Note
  onArchive: (id: string) => void
  onTodo: (id: string) => void
  onDiscard: (id: string) => void
}) {
  return (
    <li className="note-item note-item--todo">
      <span className="note-time">{toClockLabel(note.createdAt)}</span>
      <span className="note-content">
        <span className="note-text">{note.text}</span>
        <NoteTypeBadge note={note} />
      </span>
      <div className="todo-actions">
        <button
          type="button"
          className="review-btn review-btn--archive review-btn--icon"
          onClick={() => onArchive(note.id)}
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
          onClick={() => onTodo(note.id)}
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
          onClick={() => onDiscard(note.id)}
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
  )
}

function ArchivedThinkingNoteRow({
  note,
  onBackToThinking,
  onDiscard,
}: {
  note: Note
  onBackToThinking: (id: string) => void
  onDiscard: (id: string) => void
}) {
  return (
    <li className="note-item note-item--todo">
      <span className="note-time">{toClockLabel(note.createdAt)}</span>
      <span className="note-content">
        <span className="note-text">{note.text}</span>
        <NoteTypeBadge note={note} />
      </span>
      <div className="todo-actions">
        <button
          type="button"
          className="review-btn review-btn--back review-btn--icon"
          onClick={() => onBackToThinking(note.id)}
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
          onClick={() => onDiscard(note.id)}
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
  )
}

function BraindumpComposer({
  onSubmitEntries,
}: {
  onSubmitEntries: (entries: string[]) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [flashInput, setFlashInput] = useState(false)
  const composerRef = useRef<HTMLFormElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus({ preventScroll: true })
    }

    const frameId = requestAnimationFrame(focusInput)
    window.addEventListener('focus', focusInput)
    document.addEventListener('visibilitychange', focusInput)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('focus', focusInput)
      document.removeEventListener('visibilitychange', focusInput)
    }
  }, [])

  const submit = async (entries: string[]) => {
    const cleaned = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    if (cleaned.length === 0) {
      return
    }
    await onSubmitEntries(cleaned)
    setText('')
    setFlashInput(true)
    window.setTimeout(() => setFlashInput(false), 120)
    inputRef.current?.focus({ preventScroll: true })
  }

  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit([text])
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text')
    if (!pasted.includes('\n')) {
      return
    }

    event.preventDefault()
    const lines = pasted.split(/\r?\n/)
    void submit(lines)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit([text])
  }

  const handleComposerFocus = () => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return
    }
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ block: 'end' })
    })
  }

  return (
    <div className="app-content">
      <form className="capture-form braindump-composer" onSubmit={handleSubmit} ref={composerRef}>
        <textarea
          rows={2}
          ref={inputRef}
          className={flashInput ? 'capture-textarea capture-textarea--flash' : 'capture-textarea'}
          placeholder="Gedanken festhalten..."
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleTextKeyDown}
          onPaste={handlePaste}
          onFocus={handleComposerFocus}
        />
        <div className="capture-actions">
          <div className="capture-meta-row">
            <small className="capture-hint">Enter: speichern · Shift+Enter: Zeile</small>
            <small className={text.length > SOFT_CHAR_LIMIT ? 'counter counter--warning' : 'counter'}>
              {text.length} / {SOFT_CHAR_LIMIT}
            </small>
          </div>
          <button type="submit" className="capture-submit" aria-label="Notiz hinzufügen" title="Hinzufügen">
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
        {text.length > SOFT_CHAR_LIMIT ? (
          <small className="soft-limit-hint">Vielleicht sind das mehrere Gedanken.</small>
        ) : null}
      </form>
    </div>
  )
}

function BraindumpPage({
  groups,
  onUndoDelete,
  onDelete,
  endRef,
  onSubmitEntries,
}: {
  groups: Array<{ dayISO: string; label: string; notes: Note[] }>
  onUndoDelete: (id: string) => void
  onDelete: (id: string) => void
  endRef: RefObject<HTMLDivElement | null>
  onSubmitEntries: (entries: string[]) => Promise<void>
}) {
  const { setFooter } = useFooter()

  useEffect(() => {
    setFooter(<BraindumpComposer onSubmitEntries={onSubmitEntries} />)
    return () => setFooter(null)
  }, [onSubmitEntries, setFooter])

  return (
    <BraindumpList
      groups={groups}
      onUndoDelete={onUndoDelete}
      onDelete={onDelete}
      endRef={endRef}
    />
  )
}

function AppContent() {
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW()
  const [activeTab, setActiveTab] = useState<TabKey>('BRAINDUMP')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' ? 'light' : 'dark'
  })
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
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('MERGE')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [devSyncInfo, setDevSyncInfo] = useState<DevSyncInfo | null>(null)
  const [syncEnabled, setSyncEnabledState] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncUiStatus>('disabled')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncPairCode, setSyncPairCode] = useState<string | null>(null)
  const [syncRoomId, setSyncRoomId] = useState(
    () => localStorage.getItem('leiser-sync-id') || DEFAULT_SYNC_ROOM_ID,
  )
  const [syncNowBusy, setSyncNowBusy] = useState(false)
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null)
  const [staleReviewMode, setStaleReviewMode] = useState(false)
  const [staleQueueIds, setStaleQueueIds] = useState<string[]>([])
  const [staleReviewTotal, setStaleReviewTotal] = useState(0)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [lastTodoAction, setLastTodoAction] = useState<LastAction | null>(null)
  const [dismissedUpdateNotice, setDismissedUpdateNotice] = useState(false)
  const [undoBusy, setUndoBusy] = useState(false)
  const [todoUndoBusy, setTodoUndoBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const undoTimeoutRef = useRef<number | null>(null)
  const todoUndoTimeoutRef = useRef<number | null>(null)
  const mainScrollRef = useRef<HTMLElement | null>(null)
  const braindumpEndRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const nextAutoScrollBehaviorRef = useRef<ScrollBehavior>('auto')

  const todayISO = useMemo(() => getLocalDayISO(), [])
  const yesterdayISO = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return getLocalDayISO(d)
  }, [])

  const refreshAll = useCallback(async (roomIdOverride?: string) => {
    try {
      const activeRoomId = roomIdOverride ?? syncRoomId
      const [braindump, inbox, inboxTotal, decidedToday, process, processTotal, todo, archived, archivedTotal, searchable] = await Promise.all([
        listRecentActiveNotes(BRAINDUMP_FETCH_LIMIT),
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
      const syncInfo = await getSyncDebugInfo(activeRoomId)
      setSyncEnabledState(syncInfo.isEnabled)
      setSyncPairCode(await getSyncPairCode(activeRoomId))
      setDevSyncInfo(syncInfo)
    } catch {
      setError('Daten konnten nicht geladen werden.')
    }
  }, [syncRoomId, todayISO])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const stop = startSyncEngine({
      roomId: syncRoomId,
      debounceMs: 1200,
      pullIntervalMs: 90000,
      onStatusChange: (status, errorMessage) => {
        setSyncStatus(status)
        setSyncError(errorMessage ?? null)
      },
      onDataChanged: () => {
        void refreshAll()
      },
    })
    return stop
  }, [refreshAll, syncRoomId])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const handleToggleSyncEnabled = useCallback(async () => {
    setError('')
    try {
      const nextEnabled = !syncEnabled
      const nextRoomId = nextEnabled
        ? localStorage.getItem('leiser-sync-id') || crypto.randomUUID()
        : syncRoomId
      setSyncRoomId(nextRoomId)
      const next = await setSyncEnabled(nextRoomId, nextEnabled)
      setSyncEnabledState(next.isEnabled)
      setInfo(next.isEnabled ? 'Sync aktiviert.' : 'Sync deaktiviert.')
      await refreshAll(nextRoomId)
    } catch {
      setError('Sync-Status konnte nicht geändert werden.')
    }
  }, [refreshAll, syncEnabled, syncRoomId])

  const handleSyncNow = useCallback(async () => {
    setSyncNowBusy(true)
    setError('')
    try {
      await syncNow({
        roomId: syncRoomId,
        onStatusChange: (status, message) => {
          setSyncStatus(status)
          setSyncError(message ?? null)
        },
        onDataChanged: () => {
          void refreshAll(syncRoomId)
        },
      })
      await refreshAll(syncRoomId)
      setInfo('Sync erfolgreich.')
    } catch {
      setError('Sync now fehlgeschlagen.')
    } finally {
      setSyncNowBusy(false)
    }
  }, [refreshAll, syncRoomId])

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

  const isNearBottom = useCallback(() => {
    const container = mainScrollRef.current
    if (!container) {
      return true
    }
    return container.scrollHeight - container.scrollTop - container.clientHeight < AUTOSCROLL_NEAR_BOTTOM_PX
  }, [])

  const scrollToBraindumpBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    braindumpEndRef.current?.scrollIntoView({ block: 'end', behavior })
  }, [])

  const handleBraindumpSubmitEntries = useCallback(
    async (entries: string[]) => {
      if (entries.length === 0) {
        return
      }

      const nearBottom = isNearBottom()
      shouldAutoScrollRef.current = nearBottom
      nextAutoScrollBehaviorRef.current = nearBottom ? 'smooth' : 'auto'
      setError('')
      try {
        const created = await Promise.all(entries.map((entry) => addNote(entry)))
        if (created.length > 0) {
          setBraindumpNotes((prev) => {
            const next = [...created, ...prev]
            const seen = new Set<string>()
            const deduped: Note[] = []
            for (const note of next) {
              if (seen.has(note.id)) continue
              seen.add(note.id)
              deduped.push(note)
            }
            return deduped
          })
        }
        void refreshAll()
      } catch {
        setError('Notiz konnte nicht gespeichert werden.')
      }
    },
    [isNearBottom, refreshAll],
  )

  const handleDelete = useCallback(async (id: string, options?: { confirm?: boolean }) => {
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
  }, [refreshAll])

  const clearUndoTimeout = () => {
    if (undoTimeoutRef.current !== null) {
      window.clearTimeout(undoTimeoutRef.current)
      undoTimeoutRef.current = null
    }
  }

  const clearTodoUndoTimeout = () => {
    if (todoUndoTimeoutRef.current !== null) {
      window.clearTimeout(todoUndoTimeoutRef.current)
      todoUndoTimeoutRef.current = null
    }
  }

  useEffect(
    () => () => {
      clearUndoTimeout()
      clearTodoUndoTimeout()
    },
    [],
  )

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

  const startTodoUndoWindow = (action: LastAction) => {
    clearTodoUndoTimeout()
    setLastTodoAction(action)
    todoUndoTimeoutRef.current = window.setTimeout(() => {
      setLastTodoAction((current) => {
        if (!current) return null
        if (current.noteId !== action.noteId || current.at !== action.at) {
          return current
        }
        return null
      })
      todoUndoTimeoutRef.current = null
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
    setInfo('')
    setError('')
    try {
      const backup = await buildBackupData()
      const day = getLocalDayISO()
      const filename = `leiser-backup-${day}.json`
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const file = new File([blob], filename, { type: 'application/json' })
      const canShareFiles =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

      if (typeof navigator.share === 'function' && canShareFiles) {
        await navigator.share({
          files: [file],
          title: 'Leiser Backup',
        })
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        URL.revokeObjectURL(url)
      }
      setInfo('Backup erzeugt.')
    } catch (exportError) {
      if (exportError instanceof DOMException && exportError.name === 'AbortError') {
        return
      }
      setError('Backup konnte nicht exportiert werden.')
    }
  }

  const handleImport = async () => {
    if (!importFile) {
      setError('Bitte zuerst eine Backup-Datei auswählen.')
      return
    }

    setInfo('')
    setError('')
    setImportReport(null)
    try {
      const fileText = await importFile.text()
      const report = await importBackupJson(fileText, importMode)
      setImportReport(report)
      setInfo('Backup erfolgreich importiert.')
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

  const handleSeedOlderThoughts = async () => {
    setInfo('')
    setError('')
    try {
      await seedOlderThoughtsDemo()
      await refreshAll()
      setInfo('Ältere Testgedanken geladen.')
    } catch {
      setError('Testgedanken konnten nicht geladen werden.')
    }
  }

  const isSearchMode = searchQuery.trim().length > 0
  const currentReviewNote = orderedInbox[effectiveReviewIndex] ?? null
  const currentReviewCategory = currentReviewNote ? getReviewAgeCategory(currentReviewNote) : null
  const showUpdateNotice = needRefresh && !dismissedUpdateNotice
  const braindumpGroups = useMemo(() => {
    const grouped = new Map<string, Note[]>()
    for (const note of braindumpNotes) {
      const dayNotes = grouped.get(note.dayISO)
      if (dayNotes) {
        dayNotes.push(note)
      } else {
        grouped.set(note.dayISO, [note])
      }
    }
    const byCreatedAsc = (a: Note, b: Note) => a.createdAt.localeCompare(b.createdAt)
    const days = [...grouped.keys()].sort((a, b) => a.localeCompare(b))
    return days.map((dayISO) => {
      const notes = grouped.get(dayISO) ?? []
      notes.sort(byCreatedAsc)
      return {
        dayISO,
        label: getDayDividerLabel(dayISO, todayISO, yesterdayISO),
        notes,
      }
    })
  }, [
    braindumpNotes,
    todayISO,
    yesterdayISO,
  ])
  const thinkingGroups = useMemo(() => {
    const grouped = new Map<string, Note[]>()
    for (const note of processNotes) {
      const dayNotes = grouped.get(note.dayISO)
      if (dayNotes) {
        dayNotes.push(note)
      } else {
        grouped.set(note.dayISO, [note])
      }
    }
    return [...grouped.entries()]
      .sort(([dayA], [dayB]) => dayB.localeCompare(dayA))
      .map(([dayISO, notes]) => ({
      dayISO,
      label: getDayDividerLabel(dayISO, todayISO, yesterdayISO),
      notes,
      }))
  }, [processNotes, todayISO, yesterdayISO])
  const archivedThinkingGroups = useMemo(() => {
    const grouped = new Map<string, Note[]>()
    for (const note of archivedNotes) {
      const dayNotes = grouped.get(note.dayISO)
      if (dayNotes) {
        dayNotes.push(note)
      } else {
        grouped.set(note.dayISO, [note])
      }
    }
    return [...grouped.entries()]
      .sort(([dayA], [dayB]) => dayB.localeCompare(dayA))
      .map(([dayISO, notes]) => ({
      dayISO,
      label: getDayDividerLabel(dayISO, todayISO, yesterdayISO),
      notes,
      }))
  }, [archivedNotes, todayISO, yesterdayISO])

  const handleUndoDelete = useCallback((id: string) => {
    void handleDelete(id, { confirm: false })
  }, [handleDelete])

  const handleDeleteDefault = useCallback((id: string) => {
    void handleDelete(id)
  }, [handleDelete])

  const handleToggleActionMenu = useCallback((menuId: string) => {
    setOpenActionMenuId((prev) => (prev === menuId ? null : menuId))
  }, [])

  const closeActionMenu = useCallback(() => {
    setOpenActionMenuId(null)
  }, [])

  const staleTodos = useMemo(() => {
    const today = new Date()
    return todoNotes
      .filter((todo) => daysBetween(today, new Date(todo.createdAt)) > 14)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [todoNotes, todayISO])
  const staleTodosById = useMemo(() => {
    const map = new Map<string, Note>()
    for (const note of staleTodos) {
      map.set(note.id, note)
    }
    return map
  }, [staleTodos])
  const staleQueueNotes = useMemo(
    () => staleQueueIds.map((id) => staleTodosById.get(id)).filter((note): note is Note => Boolean(note)),
    [staleQueueIds, staleTodosById],
  )
  const currentStaleNote = staleQueueNotes[0] ?? null

  const startStaleReview = useCallback(() => {
    if (staleTodos.length === 0) {
      return
    }
    const queue = staleTodos.map((todo) => todo.id)
    setStaleQueueIds(queue)
    setStaleReviewTotal(queue.length)
    setStaleReviewMode(true)
  }, [staleTodos])

  const stopStaleReview = useCallback(() => {
    setStaleReviewMode(false)
    setStaleQueueIds([])
    setStaleReviewTotal(0)
  }, [])

  const handleStaleSkip = useCallback(() => {
    setStaleQueueIds((prev) => {
      if (prev.length <= 1) return prev
      return [...prev.slice(1), prev[0]]
    })
  }, [])

  const handleStaleDecision = useCallback(
    async (action: 'ARCHIVE' | 'PROCESS' | 'KEEP') => {
      if (!currentStaleNote) {
        return
      }
      setError('')
      try {
        if (action === 'ARCHIVE') {
          await updateNoteStatus(currentStaleNote.id, 'ARCHIVE')
        } else if (action === 'PROCESS') {
          await updateNoteStatus(currentStaleNote.id, 'PROCESS')
        } else {
          await updateNoteStatus(currentStaleNote.id, 'TODO')
        }
        setStaleQueueIds((prev) => prev.filter((id) => id !== currentStaleNote.id))
        await refreshAll()
      } catch {
        setError('Stale-To-Do konnte nicht aktualisiert werden.')
      }
    },
    [currentStaleNote, refreshAll],
  )

  const handleTodoStatusChange = useCallback(
    async (id: string, nextStatus: NoteStatus) => {
      const sourceNote = todoNotes.find((note) => note.id === id)
      if (!sourceNote) {
        return
      }

      setError('')
      try {
        await updateNoteStatus(id, nextStatus)
        startTodoUndoWindow({
          noteId: sourceNote.id,
          prevStatus: sourceNote.status,
          newStatus: nextStatus,
          at: Date.now(),
        })
        await refreshAll()
      } catch {
        clearTodoUndoTimeout()
        setLastTodoAction(null)
        setError('To-Do konnte nicht aktualisiert werden.')
      }
    },
    [todoNotes, refreshAll],
  )

  const handleTodoDone = useCallback(
    (id: string) => {
      void handleTodoStatusChange(id, 'DISCARD')
    },
    [handleTodoStatusChange],
  )

  const handleTodoBack = useCallback(
    (id: string) => {
      void handleTodoStatusChange(id, 'INBOX')
    },
    [handleTodoStatusChange],
  )

  const handleUndoLastTodoAction = async () => {
    if (!lastTodoAction || todoUndoBusy) {
      return
    }

    setTodoUndoBusy(true)
    setError('')
    try {
      await updateNoteStatus(lastTodoAction.noteId, lastTodoAction.prevStatus)
      clearTodoUndoTimeout()
      setLastTodoAction(null)
      await refreshAll()
    } catch {
      setError('Rückgängig für To-Do fehlgeschlagen.')
    } finally {
      setTodoUndoBusy(false)
    }
  }
  const handleThinkingArchive = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'ARCHIVE')
    },
    [handleReviewDecision],
  )
  const handleThinkingToTodo = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'TODO')
    },
    [handleReviewDecision],
  )
  const handleThinkingDiscard = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'DISCARD')
    },
    [handleReviewDecision],
  )
  const handleArchivedBackToThinking = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'PROCESS')
    },
    [handleReviewDecision],
  )

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

  const todoGroups = useMemo(() => {
    const grouped = new Map<string, Note[]>()
    for (const note of todoNotes) {
      const dayNotes = grouped.get(note.dayISO)
      if (dayNotes) {
        dayNotes.push(note)
      } else {
        grouped.set(note.dayISO, [note])
      }
    }
    return [...grouped.entries()]
      .sort(([dayA], [dayB]) => dayB.localeCompare(dayA))
      .map(([dayISO, notes]) => ({
      dayISO,
      label: getDayDividerLabel(dayISO, todayISO, yesterdayISO),
      notes,
      }))
  }, [todoNotes, todayISO, yesterdayISO])

  useEffect(() => {
    setOpenActionMenuId(null)
  }, [activeTab, isSearchMode])

  useEffect(() => {
    if (activeTab !== 'BRAINDUMP' || isSearchMode) {
      return
    }
    const frame = requestAnimationFrame(() => {
      scrollToBraindumpBottom('auto')
      shouldAutoScrollRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab, isSearchMode])

  useEffect(() => {
    if (activeTab !== 'BRAINDUMP' || isSearchMode) {
      return
    }
    if (!shouldAutoScrollRef.current) {
      return
    }
    const behavior = nextAutoScrollBehaviorRef.current
    nextAutoScrollBehaviorRef.current = 'auto'
    const frame = requestAnimationFrame(() => scrollToBraindumpBottom(behavior))
    return () => cancelAnimationFrame(frame)
  }, [activeTab, braindumpGroups, isSearchMode])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (activeTab !== 'REVIEW' || isSearchMode) return
      if (staleReviewMode) return
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
  }, [activeTab, currentReviewNote, isSearchMode, orderedInbox.length, staleReviewMode])

  return (
    <AppShell
      updateNotice={
        showUpdateNotice ? (
          <div className="app-content update-notice-inner" role="status" aria-live="polite">
            <span>Update verfügbar</span>
            <div className="update-notice-actions">
              <button
                type="button"
                className="update-notice-refresh"
                onClick={() => {
                  void updateServiceWorker(true)
                }}
              >
                Aktualisieren
              </button>
              <button
                type="button"
                className="update-notice-later"
                onClick={() => setDismissedUpdateNotice(true)}
              >
                Später
              </button>
            </div>
          </div>
        ) : null
      }
      mainRef={mainScrollRef}
      onMainScroll={() => {
        if (activeTab === 'BRAINDUMP' && !isSearchMode) {
          shouldAutoScrollRef.current = isNearBottom()
        }
      }}
      header={
        <div className="app-content app-header-inner">
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
            {syncStatus === 'offline' ? <span className="sync-pill">Offline</span> : null}
            {syncStatus === 'error' ? <span className="sync-pill sync-pill--error">Sync Fehler</span> : null}
            <NoteActionsMenu
              menuId="header-actions"
              isOpen={openActionMenuId === 'header-actions'}
              onToggle={handleToggleActionMenu}
              onClose={closeActionMenu}
              items={[
                {
                  label: theme === 'dark' ? 'Zu hellem Theme wechseln' : 'Zu dunklem Theme wechseln',
                  onSelect: () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
                },
                {
                  label: 'Backup exportieren',
                  onSelect: () => void handleExport(),
                },
                {
                  label: 'Backup importieren',
                  onSelect: () => {
                    setActiveTab('DATA')
                    setShowImportPanel(true)
                  },
                },
                {
                  label: 'Daten öffnen',
                  onSelect: () => setActiveTab('DATA'),
                },
              ]}
            />
          </div>
        </div>
      }
    >
      <section className="app-content">
            {activeTab === 'DATA' ? (
              <section className="data-section" aria-label="Daten">
                <div className="data-panel">
                  <div className="data-actions">
                    <button type="button" onClick={() => void handleExport()}>
                      Backup exportieren
                    </button>
                    <button type="button" onClick={() => setShowImportPanel((prev) => !prev)}>
                      {showImportPanel ? 'Import schließen' : 'Backup importieren'}
                    </button>
                    <button type="button" onClick={() => void handleSeedOlderThoughts()}>
                      Ältere Testgedanken laden
                    </button>
                    <button type="button" onClick={() => void handleToggleSyncEnabled()}>
                      {syncEnabled ? 'Sync deaktivieren' : 'Sync aktivieren'}
                    </button>
                    <button type="button" onClick={() => void handleSyncNow()} disabled={!syncEnabled || syncNowBusy}>
                      {syncNowBusy ? 'Sync läuft…' : 'Sync now (Debug)'}
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
                  {info ? <p className="hint">{info}</p> : null}
                  {offlineReady ? <p className="hint">Offline bereit.</p> : null}
                  {syncStatus === 'syncing' ? (
                    <p className="hint">{syncError ?? 'Sync läuft im Hintergrund.'}</p>
                  ) : null}
                  {syncStatus === 'offline' ? <p className="hint">Sync pausiert (offline).</p> : null}
                  {syncStatus === 'error' && syncError ? <p className="error-text">{syncError}</p> : null}
                  <p className="hint">Letzter Sync: {toSyncTimeLabel(devSyncInfo?.lastPushedAt ?? null)}</p>
                  {syncPairCode ? (
                    <div className="import-panel">
                      <label className="hint" htmlFor="sync-pair-code">Pair Code (mit Token)</label>
                      <textarea id="sync-pair-code" readOnly value={syncPairCode} rows={3} />
                    </div>
                  ) : null}
                  {import.meta.env.DEV && devSyncInfo ? (
                    <div className="dev-sync-panel">
                      <p className="hint">Device ID: {devSyncInfo.deviceId}</p>
                      <p className="hint">Room ID: {devSyncInfo.roomId}</p>
                      <p className="hint">Last Pulled Seq: {devSyncInfo.lastPulledSeq}</p>
                      <p className="hint">Sync enabled: {String(devSyncInfo.isEnabled)}</p>
                      <p className="hint">Sync token: {devSyncInfo.syncToken ? 'gesetzt' : 'nicht gesetzt'}</p>
                    </div>
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
                      <span className="note-time">{formatNoteTime(note, todayISO)}</span>
                      <span className="note-content">
                        <span className="note-text">{note.text}</span>
                        <span className="status-badge">{noteStatusLabel(note.status)}</span>
                        <NoteTypeBadge note={note} />
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
            <BraindumpPage
              groups={braindumpGroups}
              onUndoDelete={handleUndoDelete}
              onDelete={handleDeleteDefault}
              endRef={braindumpEndRef}
              onSubmitEntries={handleBraindumpSubmitEntries}
            />
          ) : null}

          {activeTab === 'REVIEW' ? (
            <>
              <h2>Review</h2>
              {!staleReviewMode && staleTodos.length > 0 ? (
                <section className="stale-review-banner">
                  <span>Du hast {staleTodos.length} alte To-Dos (&gt;14 Tage). Kurz prüfen?</span>
                  <button type="button" className="review-btn review-btn--todo" onClick={startStaleReview}>
                    Prüfen
                  </button>
                </section>
              ) : null}

              {staleReviewMode ? (
                currentStaleNote ? (
                  <article className="review-focus-card" aria-label="Altes To-Do im Fokus">
                    <div className="review-focus-head">
                      <span className="note-time">{toDayClockLabel(currentStaleNote.createdAt)}</span>
                      <span className="age-badge age-badge--overdue">Alt (&gt;14 Tage)</span>
                    </div>
                    <div className="review-focus-text">
                      <span className="note-text">{currentStaleNote.text}</span>
                      <NoteTypeBadge note={currentStaleNote} />
                    </div>
                    <div className="review-actions-inline">
                      <button
                        type="button"
                        className="review-btn review-btn--done"
                        onClick={() => void handleStaleDecision('ARCHIVE')}
                      >
                        Erledigt
                      </button>
                      <button
                        type="button"
                        className="review-btn review-btn--process"
                        onClick={() => void handleStaleDecision('PROCESS')}
                      >
                        In Denken
                      </button>
                      <button
                        type="button"
                        className="review-btn review-btn--skip"
                        onClick={() => void handleStaleDecision('KEEP')}
                      >
                        Behalten
                      </button>
                      <button type="button" className="review-btn review-btn--skip" onClick={handleStaleSkip}>
                        Überspringen
                      </button>
                    </div>
                    <p className="review-meta">
                      Alt (&gt;14 Tage) · {Math.max(staleReviewTotal - staleQueueIds.length + 1, 1)} von {staleReviewTotal}
                    </p>
                  </article>
                ) : (
                  <article className="review-focus-card" aria-label="Stale-Review abgeschlossen">
                    <p className="empty-text">Alles geprüft.</p>
                    <div className="review-actions-inline">
                      <button type="button" className="review-btn review-btn--todo" onClick={stopStaleReview}>
                        Zurück zum Review
                      </button>
                    </div>
                  </article>
                )
              ) : currentReviewNote ? (
                <article className="review-focus-card" aria-label="Aktueller Gedanke">
                  <div className="review-focus-head">
                    <span className="note-time">{toClockLabel(currentReviewNote.createdAt)}</span>
                    <span className={`age-badge age-badge--${currentReviewCategory?.toLowerCase()}`}>
                      {reviewAgeLabel(currentReviewCategory ?? 'READY')}
                    </span>
                  </div>
                  <div className="review-focus-text">
                    <span className="note-text">{currentReviewNote.text}</span>
                    <NoteTypeBadge note={currentReviewNote} />
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
                      <span className="note-time">{formatNoteTime(note, todayISO)}</span>
                            <span className="note-content">
                              <span className="note-text">{note.text}</span>
                              <span className="status-badge">{noteStatusLabel(note.status)}</span>
                              <NoteTypeBadge note={note} />
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
            {thinkingGroups.map((group) => (
              <section key={group.dayISO} className="note-group">
                <div className="day-divider">{group.label}</div>
                <ul className="notes-list" aria-label={`Denken ${group.label}`}>
                  {group.notes.map((note) => (
                    <ThinkingNoteRow
                      key={note.id}
                      note={note}
                      onArchive={handleThinkingArchive}
                      onTodo={handleThinkingToTodo}
                      onDiscard={handleThinkingDiscard}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {showArchive ? (
              <>
                <h3 className="archive-title">Archiv</h3>
                {archivedNotes.length === 0 ? <p className="empty-text">Archiv ist leer.</p> : null}
                {archivedThinkingGroups.map((group) => (
                  <section key={group.dayISO} className="note-group">
                    <div className="day-divider">{group.label}</div>
                    <ul className="notes-list" aria-label={`Archiv ${group.label}`}>
                      {group.notes.map((note) => (
                        <ArchivedThinkingNoteRow
                          key={note.id}
                          note={note}
                          onBackToThinking={handleArchivedBackToThinking}
                          onDiscard={handleThinkingDiscard}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
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
            {lastTodoAction ? (
              <div className="undo-snackbar undo-snackbar--subtle" role="status" aria-live="polite">
                <span>{todoActionLabel(lastTodoAction.newStatus)}</span>
                <button
                  type="button"
                  onClick={() => void handleUndoLastTodoAction()}
                  disabled={todoUndoBusy}
                >
                  Rückgängig
                </button>
              </div>
            ) : null}
            {todoNotes.length === 0 ? <p className="empty-text">Keine offenen To-Dos.</p> : null}
            {todoGroups.map((group) => (
              <section key={group.dayISO} className="note-group">
                <div className="day-divider">{group.label}</div>
                <ul className="notes-list" aria-label={`To-Do ${group.label}`}>
                  {group.notes.map((note) => (
                    <TodoNoteRow
                      key={note.id}
                      note={note}
                      todayISO={todayISO}
                      onDone={handleTodoDone}
                      onBack={handleTodoBack}
                    />
                  ))}
                </ul>
              </section>
            ))}
            </>
          ) : null}

              {info && activeTab !== 'DATA' ? <p className="hint">{info}</p> : null}
              {error ? <p className="error-text">{error}</p> : null}
            </>
          ) : null}
          </div>
        </section>
    </AppShell>
  )
}

export function App() {
  return (
    <FooterProvider>
      <AppContent />
    </FooterProvider>
  )
}
