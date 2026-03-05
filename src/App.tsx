import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import Fuse from 'fuse.js'
import QRCode from 'qrcode'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  DEFAULT_SYNC_ROOM_ID,
  addNote,
  countInboxNotes,
  countNotesByStatus,
  deleteNote,
  getSyncDebugInfo,
  getSyncState,
  getSyncPairCode,
  listDecidedNotesByDay,
  listInboxNotes,
  listAutoArchiveCandidates,
  listNotesByStatus,
  listRecentActiveNotes,
  listSearchableNotes,
  listTodoNotes,
  setSyncEnabled,
  updateSyncState,
  updateNoteArchiveBucket,
  updateNoteStarred,
  updateNoteStatus,
} from './lib/dbNotes'
import { buildBackupData, importBackupJson, type ImportMode, type ImportReport } from './lib/backup'
import { getLocalDayISO, getYesterdayISO, groupNotesByDay } from './lib/date'
import type { Note, NoteStatus, NoteType } from './lib/types'
import { AppShell } from './app/AppShell'
import { FooterProvider, useFooter } from './app/FooterContext'
import { seedOlderThoughtsDemo } from './lib/demoNotes'
import { getSupabaseRuntimeConfig } from './lib/runtimeConfig'
import { startSyncEngine, syncNow, type SyncDiagnostics, type SyncUiStatus } from './lib/syncEngine'

type TabKey = 'BRAINDUMP' | 'REVIEW' | 'THINKING' | 'TODO' | 'DATA'
const SOFT_CHAR_LIMIT = 200
const THEME_KEY = 'leiser:theme'
const SEARCH_RESULT_LIMIT = 50
const REVIEW_LIMIT = 50
const FRESH_HOURS = 12
const OVERDUE_DAYS = 3
const AUTOSCROLL_NEAR_BOTTOM_PX = 80
const BRAINDUMP_FETCH_LIMIT = 300
const REVIEW_LAYOUT_KEY = 'leiser:review-layout'
const BRAINDUMP_COLLAPSE_THRESHOLD = 40
const AUTO_ARCHIVE_DAYS = 90
const AUTO_ARCHIVE_BATCH_LIMIT = 100
const AUTO_ARCHIVE_LAST_RUN_KEY = 'leiser:auto-archive-last-run-day'
const SYNC_ID_STORAGE_KEY = 'leiser-sync-id'
const SYNC_TOKEN_STORAGE_KEY = 'leiser-sync-token'
const SYNC_KEY_STORAGE_KEY = 'leiser-sync-key'
const RELOAD_AFTER_INACTIVITY_MS = 20 * 60 * 1000

type PairingPayloadV1 = {
  v: 1
  roomId: string
  token: string
  key?: string
}

type ReviewAgeCategory = 'OVERDUE' | 'READY' | 'FRESH'
type ReviewLayoutPreference = 'AUTO' | 'SINGLE' | 'LIST'
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

function encodeBase64Url(input: string) {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4
  const padded = normalized + (padding > 0 ? '='.repeat(4 - padding) : '')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePairingPayload(input: string): PairingPayloadV1 {
  const trimmed = input.trim()
  let jsonText = trimmed

  if (trimmed.startsWith('leiser://pair?')) {
    jsonText = decodeBase64Url(trimmed.slice('leiser://pair?'.length))
  } else if (trimmed.startsWith('LEISERPAIR:')) {
    jsonText = decodeBase64Url(trimmed.slice('LEISERPAIR:'.length))
  }

  const parsed = JSON.parse(jsonText) as unknown
  if (!isObjectRecord(parsed)) {
    throw new Error('invalid payload')
  }

  const roomId = typeof parsed.roomId === 'string' ? parsed.roomId.trim() : ''
  const token = typeof parsed.token === 'string' ? parsed.token.trim() : ''
  const key = typeof parsed.key === 'string' ? parsed.key.trim() : ''
  const version = parsed.v
  const isLegacy = version == null
  if ((!isLegacy && version !== 1) || roomId.length === 0 || token.length === 0) {
    throw new Error('invalid payload')
  }

  return {
    v: 1,
    roomId,
    token,
    ...(key ? { key } : {}),
  }
}

function isTokenRejectedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message.toLowerCase()
  return (
    message.includes('401') ||
    message.includes('permission denied') ||
    message.includes('jwt') ||
    message.includes('row-level security')
  )
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

function ExpandableNoteText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const textRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (expanded) {
      return
    }
    const frameId = requestAnimationFrame(() => {
      const element = textRef.current
      if (!element) {
        return
      }
      setCanExpand(element.scrollHeight - element.clientHeight > 2)
    })
    return () => cancelAnimationFrame(frameId)
  }, [expanded, text])

  return (
    <span className={canExpand && !expanded ? 'note-text-wrap note-text-wrap--collapsed' : 'note-text-wrap'}>
      <span ref={textRef} className={expanded ? 'note-text note-text--expanded' : 'note-text'}>
        {text}
      </span>
      {canExpand ? (
        <button
          type="button"
          className="note-text-toggle-btn"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Text einklappen' : 'Text ausklappen'}
          title={expanded ? 'Weniger anzeigen' : 'Mehr anzeigen'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {expanded ? (
              <path
                d="m7 14 5-5 5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path
                d="m7 10 5 5 5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </button>
      ) : null}
    </span>
  )
}

function noteStatusLabel(status: NoteStatus) {
  if (status === 'INBOX') return 'Inbox'
  if (status === 'TODO') return 'To-Do'
  if (status === 'PROCESS') return 'Gedanken'
  if (status === 'ARCHIVE') return 'Archiv'
  return 'Verworfen'
}

function todoActionLabel(status: NoteStatus) {
  if (status === 'ARCHIVE') return 'Als erledigt markiert.'
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

function reviewAgeLabel(category: ReviewAgeCategory): string | null {
  if (category === 'OVERDUE') return 'Überfällig'
  return null
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
      <span className="note-content">
        <ExpandableNoteText text={note.text} />
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
  collapsedDays,
  onToggleDay,
}: {
  groups: Array<{ dayISO: string; label: string; notes: Note[] }>
  onUndoDelete: (id: string) => void
  onDelete: (id: string) => void
  endRef: RefObject<HTMLDivElement | null>
  collapsedDays: Record<string, boolean>
  onToggleDay: (dayISO: string) => void
}) {
  if (groups.length === 0) {
    return <p className="empty-text">Noch keine Notizen.</p>
  }

  const getAgeToneClass = (dayISO: string) => {
    const groupDate = new Date(`${dayISO}T12:00:00`)
    if (Number.isNaN(groupDate.getTime())) {
      return ''
    }
    const ageDays = daysBetween(new Date(), groupDate)
    if (ageDays >= 60) return 'note-group--aged-3'
    if (ageDays >= 30) return 'note-group--aged-2'
    if (ageDays >= 14) return 'note-group--aged-1'
    return ''
  }

  return (
    <>
      {groups.map((group) => {
        const isCollapsed = Boolean(collapsedDays[group.dayISO])
        const ageToneClass = getAgeToneClass(group.dayISO)
        return (
          <section key={group.dayISO} className={ageToneClass ? `note-group ${ageToneClass}` : 'note-group'}>
            <button
              type="button"
              className="day-divider day-divider-toggle"
              onClick={() => onToggleDay(group.dayISO)}
              aria-expanded={!isCollapsed}
              aria-controls={`braindump-group-${group.dayISO}`}
            >
              <span>{group.label} ({group.notes.length})</span>
              <svg
                className={isCollapsed ? 'day-divider-toggle-icon' : 'day-divider-toggle-icon day-divider-toggle-icon--open'}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="m8 10 4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {!isCollapsed ? (
              <ul id={`braindump-group-${group.dayISO}`} className="notes-list" aria-label={`${group.label} Notizen`}>
                {group.notes.map((note) => (
                  <BraindumpNoteRow
                    key={note.id}
                    note={note}
                    onUndoDelete={onUndoDelete}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        )
      })}
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
  onToggleStar,
  onDone,
  onBack,
}: {
  note: Note
  onToggleStar: (id: string, starred: boolean) => void
  onDone: (id: string) => void
  onBack: (id: string) => void
}) {
  return (
    <li key={note.id} className="note-item note-item--todo">
      <span className="note-content">
        <ExpandableNoteText text={note.text} />
        {note.starred ? <span className="status-badge">Wichtig</span> : null}
        <NoteTypeBadge note={note} />
      </span>
      <div className="todo-actions">
        <button
          type="button"
          className={note.starred ? 'review-btn review-btn--star review-btn--star-active review-btn--icon' : 'review-btn review-btn--star review-btn--icon'}
          onClick={() => onToggleStar(note.id, !note.starred)}
          aria-label={note.starred ? 'Priorität entfernen' : 'Als wichtig markieren'}
          title={note.starred ? 'Stern entfernen' : 'Mit Stern markieren'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m12 3.8 2.6 5.2 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z"
              fill={note.starred ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
        </button>
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
      <span className="note-content">
        <ExpandableNoteText text={note.text} />
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
      <span className="note-content">
        <ExpandableNoteText text={note.text} />
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

function ArchivedTodoNoteRow({
  note,
  onBackToTodo,
  onDiscard,
}: {
  note: Note
  onBackToTodo: (id: string) => void
  onDiscard: (id: string) => void
}) {
  return (
    <li className="note-item note-item--todo">
      <span className="note-content">
        <ExpandableNoteText text={note.text} />
        <NoteTypeBadge note={note} />
      </span>
      <div className="todo-actions">
        <button
          type="button"
          className="review-btn review-btn--todo review-btn--icon"
          onClick={() => onBackToTodo(note.id)}
          aria-label="Zurück zu To-Do"
          title="Zurück zu To-Do"
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

function BraindumpComposer({
  onSubmitEntries,
}: {
  onSubmitEntries: (entries: string[]) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [flashInput, setFlashInput] = useState(false)
  const composerRef = useRef<HTMLFormElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const submit = async (entries: string[]) => {
    const cleaned = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    if (cleaned.length === 0) {
      return
    }
    await onSubmitEntries(cleaned)
    setText('')
    setFlashInput(true)
    window.setTimeout(() => setFlashInput(false), 120)
    if (!(typeof window !== 'undefined' && window.visualViewport)) {
      inputRef.current?.focus({ preventScroll: true })
    }
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit([text])
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
        />
        <div className="capture-actions">
          <div className="capture-meta-row">
            <small className={text.length > SOFT_CHAR_LIMIT ? 'counter counter--warning' : 'counter'}>
              {text.length} / {SOFT_CHAR_LIMIT}
            </small>
            <span className="capture-separator" aria-hidden="true">·</span>
            <small className="capture-hint">Enter: speichern</small>
          </div>
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
  todayISO,
  yesterdayISO,
  onUndoDelete,
  onDelete,
  endRef,
  onSubmitEntries,
}: {
  groups: Array<{ dayISO: string; label: string; notes: Note[] }>
  todayISO: string
  yesterdayISO: string
  onUndoDelete: (id: string) => void
  onDelete: (id: string) => void
  endRef: RefObject<HTMLDivElement | null>
  onSubmitEntries: (entries: string[]) => Promise<void>
}) {
  const { setFooter } = useFooter()
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({})

  const totalNotes = useMemo(
    () => groups.reduce((sum, group) => sum + group.notes.length, 0),
    [groups],
  )

  const collapsedDays = useMemo(() => {
    const next: Record<string, boolean> = {}
    for (const group of groups) {
      const defaultCollapsed =
        totalNotes > BRAINDUMP_COLLAPSE_THRESHOLD &&
        group.dayISO !== todayISO &&
        group.dayISO !== yesterdayISO
      next[group.dayISO] =
        group.dayISO in collapsedOverrides ? collapsedOverrides[group.dayISO] : defaultCollapsed
    }
    return next
  }, [collapsedOverrides, groups, totalNotes, todayISO, yesterdayISO])

  const handleToggleDay = useCallback((dayISO: string) => {
    setCollapsedOverrides((prev) => {
      const defaultCollapsed =
        totalNotes > BRAINDUMP_COLLAPSE_THRESHOLD &&
        dayISO !== todayISO &&
        dayISO !== yesterdayISO
      const current = dayISO in prev ? prev[dayISO] : defaultCollapsed
      return {
        ...prev,
        [dayISO]: !current,
      }
    })
  }, [totalNotes, todayISO, yesterdayISO])

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
      collapsedDays={collapsedDays}
      onToggleDay={handleToggleDay}
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
  const [reviewLayoutPreference, setReviewLayoutPreference] = useState<ReviewLayoutPreference>(() => {
    const stored = localStorage.getItem(REVIEW_LAYOUT_KEY)
    if (stored === 'SINGLE' || stored === 'LIST' || stored === 'AUTO') {
      return stored
    }
    return 'AUTO'
  })
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null)
  const [showDecidedToday, setShowDecidedToday] = useState(false)
  const [processNotes, setProcessNotes] = useState<Note[]>([])
  const [processCount, setProcessCount] = useState(0)
  const [todoNotes, setTodoNotes] = useState<Note[]>([])
  const [todoStarOnly, setTodoStarOnly] = useState(false)
  const [archivedNotes, setArchivedNotes] = useState<Note[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchableNotes, setSearchableNotes] = useState<Note[]>([])
  const [showArchive, setShowArchive] = useState(false)
  const [showTodoArchive, setShowTodoArchive] = useState(false)
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('MERGE')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [devSyncInfo, setDevSyncInfo] = useState<DevSyncInfo | null>(null)
  const [syncEnabled, setSyncEnabledState] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncUiStatus>('disabled')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncDiagnostics, setSyncDiagnostics] = useState<SyncDiagnostics | null>(null)
  const [syncPairCode, setSyncPairCode] = useState<string | null>(null)
  const [syncPairCodeDraft, setSyncPairCodeDraft] = useState('')
  const [syncRoomId, setSyncRoomId] = useState(
    () => localStorage.getItem('leiser-sync-id') || DEFAULT_SYNC_ROOM_ID,
  )
  const [syncNowBusy, setSyncNowBusy] = useState(false)
  const [showPairQr, setShowPairQr] = useState(false)
  const [pairQrValue, setPairQrValue] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [scannerHint, setScannerHint] = useState<string | null>(null)
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
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null)
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const nextAutoScrollBehaviorRef = useRef<ScrollBehavior>('auto')
  const hiddenAtRef = useRef<number | null>(null)

  const todayISO = useMemo(() => getLocalDayISO(), [])
  const yesterdayISO = useMemo(() => getYesterdayISO(), [])

  const refreshAll = useCallback(async (roomIdOverride?: string) => {
    try {
      const autoArchiveRunDay = getLocalDayISO()
      if (localStorage.getItem(AUTO_ARCHIVE_LAST_RUN_KEY) !== autoArchiveRunDay) {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - AUTO_ARCHIVE_DAYS)
        const cutoffISO = cutoffDate.toISOString()
        const autoArchiveCandidates = await listAutoArchiveCandidates(cutoffISO, AUTO_ARCHIVE_BATCH_LIMIT)
        if (autoArchiveCandidates.length > 0) {
          await Promise.all(autoArchiveCandidates.map((note) => updateNoteStatus(note.id, 'ARCHIVE')))
        }
        localStorage.setItem(AUTO_ARCHIVE_LAST_RUN_KEY, autoArchiveRunDay)
      }

      const activeRoomId = roomIdOverride ?? syncRoomId
      const [braindump, inbox, inboxTotal, decidedToday, process, processTotal, todo, archived, searchable] = await Promise.all([
        listRecentActiveNotes(BRAINDUMP_FETCH_LIMIT),
        listInboxNotes(REVIEW_LIMIT),
        countInboxNotes(),
        listDecidedNotesByDay(todayISO, 200),
        listNotesByStatus('PROCESS', 200),
        countNotesByStatus('PROCESS'),
        listTodoNotes(200),
        listNotesByStatus('ARCHIVE', 50),
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
      debounceMs: 600,
      pullIntervalMs: 4000,
      onStatusChange: (status, errorMessage) => {
        setSyncStatus(status)
        setSyncError(errorMessage ?? null)
      },
      onDiagnostics: (diagnostics) => {
        setSyncDiagnostics(diagnostics)
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

  useEffect(() => {
    localStorage.setItem(REVIEW_LAYOUT_KEY, reviewLayoutPreference)
  }, [reviewLayoutPreference])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        return
      }

      const hiddenAt = hiddenAtRef.current
      hiddenAtRef.current = null
      if (!hiddenAt) {
        return
      }

      if (Date.now() - hiddenAt >= RELOAD_AFTER_INACTIVITY_MS) {
        window.location.reload()
      }
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

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
        onDiagnostics: (diagnostics) => {
          setSyncDiagnostics(diagnostics)
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

  const stopScanner = useCallback(() => {
    scannerControlsRef.current?.stop()
    scannerControlsRef.current = null
    scannerReaderRef.current = null
    const stream = scannerVideoRef.current?.srcObject
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    if (scannerVideoRef.current) {
      scannerVideoRef.current.srcObject = null
    }
  }, [])

  const runSyncNowForRoom = useCallback(
    async (roomId: string) => {
      setSyncNowBusy(true)
      try {
        await syncNow({
          roomId,
          onStatusChange: (status, message) => {
            setSyncStatus(status)
            setSyncError(message ?? null)
          },
          onDiagnostics: (diagnostics) => {
            setSyncDiagnostics(diagnostics)
          },
          onDataChanged: () => {
            void refreshAll(roomId)
          },
        })
        await refreshAll(roomId)
      } finally {
        setSyncNowBusy(false)
      }
    },
    [refreshAll],
  )

  const applyPairingPayload = useCallback(
    async (payload: PairingPayloadV1) => {
      const previousRoomId = syncRoomId
      const previousStorage = {
        roomId: localStorage.getItem(SYNC_ID_STORAGE_KEY),
        token: localStorage.getItem(SYNC_TOKEN_STORAGE_KEY),
        key: localStorage.getItem(SYNC_KEY_STORAGE_KEY),
      }
      const previousRoomState = await getSyncState(previousRoomId)
      const previousTargetState =
        payload.roomId === previousRoomId ? previousRoomState : await getSyncState(payload.roomId)

      localStorage.setItem(SYNC_ID_STORAGE_KEY, payload.roomId)
      localStorage.setItem(SYNC_TOKEN_STORAGE_KEY, payload.token)
      if (payload.key) {
        localStorage.setItem(SYNC_KEY_STORAGE_KEY, payload.key)
      } else {
        localStorage.removeItem(SYNC_KEY_STORAGE_KEY)
      }

      setSyncRoomId(payload.roomId)
      await updateSyncState(payload.roomId, {
        isEnabled: true,
        syncToken: payload.token,
        lastError: null,
      })
      setSyncEnabledState(true)
      await refreshAll(payload.roomId)

      try {
        await runSyncNowForRoom(payload.roomId)
        setInfo('Gerät gekoppelt. Sync erfolgreich.')
      } catch (error) {
        if (isTokenRejectedError(error)) {
          if (previousStorage.roomId && previousStorage.token) {
            localStorage.setItem(SYNC_ID_STORAGE_KEY, previousStorage.roomId)
            localStorage.setItem(SYNC_TOKEN_STORAGE_KEY, previousStorage.token)
          } else {
            localStorage.removeItem(SYNC_ID_STORAGE_KEY)
            localStorage.removeItem(SYNC_TOKEN_STORAGE_KEY)
          }
          if (previousStorage.key) {
            localStorage.setItem(SYNC_KEY_STORAGE_KEY, previousStorage.key)
          } else {
            localStorage.removeItem(SYNC_KEY_STORAGE_KEY)
          }

          await updateSyncState(payload.roomId, {
            isEnabled: previousTargetState.isEnabled,
            syncToken: previousTargetState.syncToken,
            lastError: previousTargetState.lastError,
            lastPulledSeq: previousTargetState.lastPulledSeq,
            lastPushedAt: previousTargetState.lastPushedAt,
          })
          setSyncRoomId(previousRoomId)
          setSyncEnabledState(previousRoomState.isEnabled)
          await refreshAll(previousRoomId)
          setError('Token abgelehnt – Pairing-Code stimmt nicht.')
          return
        }
        setError('Gerät gekoppelt, aber Sync-Test fehlgeschlagen.')
      }
    },
    [refreshAll, runSyncNowForRoom, syncRoomId],
  )

  const handleShowPairQr = useCallback(() => {
    setError('')
    setInfo('')
    try {
      if (!syncPairCode) {
        setError('Kein Pair Code vorhanden. Aktiviere zuerst Sync.')
        return
      }
      const parsed = JSON.parse(syncPairCode) as unknown
      if (!isObjectRecord(parsed) || typeof parsed.roomId !== 'string' || typeof parsed.token !== 'string') {
        setError('Pair Code ungültig.')
        return
      }
      const syncKey = localStorage.getItem(SYNC_KEY_STORAGE_KEY)?.trim()
      const payload: PairingPayloadV1 = {
        v: 1,
        roomId: parsed.roomId.trim(),
        token: parsed.token.trim(),
        ...(syncKey ? { key: syncKey } : {}),
      }
      const encoded = encodeBase64Url(JSON.stringify(payload))
      setPairQrValue(`leiser://pair?${encoded}`)
      setShowPairQr(true)
    } catch {
      setError('Pair Code ungültig.')
    }
  }, [syncPairCode])

  const handleImportPairCode = useCallback(async () => {
    setError('')
    setInfo('')
    let payload: PairingPayloadV1
    try {
      payload = parsePairingPayload(syncPairCodeDraft)
    } catch {
      setError('QR-Code ungültig.')
      return
    }
    try {
      await applyPairingPayload(payload)
      setSyncPairCodeDraft('')
    } catch {
      setError('Pairing fehlgeschlagen.')
    }
  }, [applyPairingPayload, syncPairCodeDraft])

  const handleCopyPairCode = useCallback(async () => {
    if (!syncPairCode) {
      return
    }
    try {
      await navigator.clipboard.writeText(syncPairCode)
      setInfo('Pair Code kopiert.')
    } catch {
      setError('Kopieren fehlgeschlagen.')
    }
  }, [syncPairCode])

  const handlePasteFromClipboard = useCallback(async () => {
    setError('')
    try {
      const clipText = await navigator.clipboard.readText()
      setSyncPairCodeDraft(clipText)
    } catch {
      setError('Zwischenablage konnte nicht gelesen werden.')
    }
  }, [])

  const handleScannerCancel = useCallback(() => {
    stopScanner()
    setShowScanner(false)
  }, [stopScanner])

  const handleScanResult = useCallback(
    async (rawText: string) => {
      stopScanner()
      setShowScanner(false)
      let payload: PairingPayloadV1
      try {
        payload = parsePairingPayload(rawText)
      } catch {
        setError('QR-Code ungültig.')
        return
      }
      try {
        await applyPairingPayload(payload)
      } catch {
        setError('Pairing fehlgeschlagen.')
      }
    },
    [applyPairingPayload, stopScanner],
  )

  const handleOpenScanner = useCallback(() => {
    setError('')
    setScannerHint(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerHint('Kamera nicht verfügbar. Nutze stattdessen „Pair Code einfügen“.')
      return
    }
    setShowScanner(true)
  }, [])

  useEffect(() => {
    if (!showPairQr || !pairQrValue || !qrCanvasRef.current) {
      return
    }
    void QRCode.toCanvas(qrCanvasRef.current, pairQrValue, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
  }, [pairQrValue, showPairQr])

  useEffect(() => {
    if (!showScanner) {
      stopScanner()
      return
    }

    let active = true
    const start = async () => {
      const videoElement = scannerVideoRef.current
      if (!videoElement) {
        return
      }
      try {
        const reader = new BrowserMultiFormatReader()
        scannerReaderRef.current = reader
        const controls = await reader.decodeFromVideoDevice(undefined, videoElement, (result) => {
          if (!result || !active) {
            return
          }
          void handleScanResult(result.getText())
        })
        if (!active) {
          controls.stop()
          return
        }
        scannerControlsRef.current = controls
      } catch {
        setScannerHint('Kamera blockiert oder nicht verfügbar. Nutze stattdessen „Pair Code einfügen“.')
        setShowScanner(false)
      }
    }

    void start()
    return () => {
      active = false
      stopScanner()
    }
  }, [handleScanResult, showScanner, stopScanner])

  const orderedInbox = useMemo(() => sortInboxForReview(inboxNotes), [inboxNotes])
  const resolvedReviewLayout = useMemo<'SINGLE' | 'LIST'>(() => {
    if (reviewLayoutPreference === 'AUTO') {
      return orderedInbox.length > 3 ? 'LIST' : 'SINGLE'
    }
    return reviewLayoutPreference
  }, [orderedInbox.length, reviewLayoutPreference])
  const reviewListGroups = useMemo(() => {
    const overdue: Note[] = []
    const ready: Note[] = []
    const fresh: Note[] = []
    for (const note of orderedInbox) {
      const category = getReviewAgeCategory(note)
      if (category === 'OVERDUE') overdue.push(note)
      else if (category === 'READY') ready.push(note)
      else fresh.push(note)
    }
    return [
      { key: 'OVERDUE', label: 'Überfällig', notes: overdue },
      { key: 'READY', label: 'Bereit', notes: [...ready, ...fresh] },
    ] as const
  }, [orderedInbox])
  const supabaseConfigStatus = useMemo(() => getSupabaseRuntimeConfig(), [])
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

  const startUndoWindow = useCallback((action: LastAction) => {
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
  }, [])

  const startTodoUndoWindow = useCallback((action: LastAction) => {
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
  }, [])

  const handleReviewDecision = useCallback(async (
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
  }, [refreshAll, startUndoWindow])

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

  const handleSkipReview = useCallback(() => {
    if (orderedInbox.length <= 1) {
      return
    }
    setCurrentNoteId(null)
    setReviewIndex((effectiveReviewIndex + 1) % orderedInbox.length)
  }, [effectiveReviewIndex, orderedInbox.length])

  const handleExport = async () => {
    setInfo('')
    setError('')
    try {
      const backup = await buildBackupData()
      const day = getLocalDayISO()
      const filename = `leiser-backup-${day}.json`
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const file = new File([blob], filename, { type: 'application/json' })
      let canShareFiles = false
      if (typeof navigator.canShare === 'function') {
        try {
          canShareFiles = navigator.canShare({ files: [file] })
        } catch {
          canShareFiles = false
        }
      }

      let shared = false
      if (typeof navigator.share === 'function' && canShareFiles) {
        try {
          await navigator.share({
            files: [file],
            title: 'Leiser Backup',
          })
          shared = true
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') {
            return
          }
          shared = false
        }
      }

      if (!shared) {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1500)
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
  const clearSearchInput = useCallback(() => {
    setSearchQuery('')
    requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true })
    })
  }, [])
  const currentReviewNote = orderedInbox[effectiveReviewIndex] ?? null
  const currentReviewCategory = currentReviewNote ? getReviewAgeCategory(currentReviewNote) : null
  const showUpdateNotice = needRefresh && !dismissedUpdateNotice
  const braindumpGroups = useMemo(() => {
    return groupNotesByDay(braindumpNotes, {
      todayISO,
      yesterdayISO,
      daySort: 'asc',
      noteSort: (a, b) => a.createdAt.localeCompare(b.createdAt),
    })
  }, [braindumpNotes, todayISO, yesterdayISO])
  const thinkingGroups = useMemo(() => {
    return groupNotesByDay(processNotes, {
      todayISO,
      yesterdayISO,
      daySort: 'desc',
      noteSort: (a, b) => {
        const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
        if (byUpdated !== 0) {
          return byUpdated
        }
        return b.createdAt.localeCompare(a.createdAt)
      },
    })
  }, [processNotes, todayISO, yesterdayISO])
  const thinkingArchivedNotes = useMemo(
    () =>
      archivedNotes.filter(
        (note) => note.archiveBucket === 'THINKING' || (note.archiveBucket == null && note.type !== 'TASK'),
      ),
    [archivedNotes],
  )
  const todoArchivedNotes = useMemo(
    () =>
      archivedNotes.filter(
        (note) => note.archiveBucket === 'TODO' || (note.archiveBucket == null && note.type === 'TASK'),
      ),
    [archivedNotes],
  )
  const thinkingArchiveCount = thinkingArchivedNotes.length
  const todoArchiveCount = todoArchivedNotes.length
  const archivedThinkingGroups = useMemo(() => {
    return groupNotesByDay(thinkingArchivedNotes, {
      todayISO,
      yesterdayISO,
      daySort: 'desc',
      noteSort: (a, b) => {
        const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
        if (byUpdated !== 0) {
          return byUpdated
        }
        return b.createdAt.localeCompare(a.createdAt)
      },
    })
  }, [thinkingArchivedNotes, todayISO, yesterdayISO])
  const archivedTodoGroups = useMemo(() => {
    return groupNotesByDay(todoArchivedNotes, {
      todayISO,
      yesterdayISO,
      daySort: 'desc',
      noteSort: (a, b) => {
        const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
        if (byUpdated !== 0) {
          return byUpdated
        }
        return b.createdAt.localeCompare(a.createdAt)
      },
    })
  }, [todoArchivedNotes, todayISO, yesterdayISO])

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
  }, [todoNotes])
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
          await updateNoteArchiveBucket(currentStaleNote.id, 'TODO')
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
    [todoNotes, refreshAll, startTodoUndoWindow],
  )

  const handleTodoDone = useCallback(
    async (id: string) => {
      const sourceNote = todoNotes.find((note) => note.id === id)
      if (!sourceNote) {
        return
      }
      setError('')
      try {
        await updateNoteArchiveBucket(id, 'TODO')
        setShowTodoArchive(true)
        startTodoUndoWindow({
          noteId: sourceNote.id,
          prevStatus: sourceNote.status,
          newStatus: 'ARCHIVE',
          at: Date.now(),
        })
        setInfo('To-Do ins Archiv verschoben.')
        await refreshAll()
      } catch {
        clearTodoUndoTimeout()
        setLastTodoAction(null)
        setError('To-Do konnte nicht aktualisiert werden.')
      }
    },
    [todoNotes, refreshAll, startTodoUndoWindow],
  )

  const handleTodoBack = useCallback(
    (id: string) => {
      void handleTodoStatusChange(id, 'INBOX')
    },
    [handleTodoStatusChange],
  )

  const handleTodoToggleStar = useCallback(
    async (id: string, starred: boolean) => {
      setError('')
      try {
        await updateNoteStarred(id, starred)
        await refreshAll()
      } catch {
        setError('Priorität konnte nicht aktualisiert werden.')
      }
    },
    [refreshAll],
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
    async (id: string) => {
      setError('')
      try {
        await updateNoteArchiveBucket(id, 'THINKING')
        await refreshAll()
      } catch {
        setError('Gedanke konnte nicht archiviert werden.')
      }
    },
    [refreshAll],
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
  const handleArchivedBackToTodo = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'TODO')
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

  const visibleTodoNotes = useMemo(
    () => (todoStarOnly ? todoNotes.filter((note) => note.starred) : todoNotes),
    [todoNotes, todoStarOnly],
  )

  const todoGroups = useMemo(() => {
    return groupNotesByDay(visibleTodoNotes, {
      todayISO,
      yesterdayISO,
      daySort: 'desc',
      noteSort: (a, b) => {
        if (a.starred !== b.starred) {
          return a.starred ? -1 : 1
        }
        return b.createdAt.localeCompare(a.createdAt)
      },
    })
  }, [visibleTodoNotes, todayISO, yesterdayISO])

  useEffect(() => {
    setOpenActionMenuId(null)
  }, [activeTab, isSearchMode, scrollToBraindumpBottom])

  useEffect(() => {
    if (activeTab !== 'BRAINDUMP' || isSearchMode) {
      return
    }
    const frame = requestAnimationFrame(() => {
      scrollToBraindumpBottom('auto')
      shouldAutoScrollRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab, isSearchMode, scrollToBraindumpBottom])

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
  }, [activeTab, braindumpGroups, isSearchMode, scrollToBraindumpBottom])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (activeTab !== 'REVIEW' || isSearchMode) return
      if (staleReviewMode) return
      if (resolvedReviewLayout !== 'SINGLE') return
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
  }, [activeTab, currentReviewNote, isSearchMode, staleReviewMode, resolvedReviewLayout, handleSkipReview, handleReviewDecision])

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
        <div className={isSearchMode ? 'app-content app-header-inner app-header-inner--search' : 'app-content app-header-inner'}>
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
              aria-label="Gedanken"
              title="Gedanken"
            >
              Gedanken
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

          <div className={isSearchMode ? 'header-search header-search--active' : 'header-search'}>
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Suche Gedanken..."
              aria-label="Suche Gedanken"
            />
            {isSearchMode ? (
              <button type="button" className="header-search-reset" onClick={clearSearchInput} aria-label="Suche leeren">
                ×
              </button>
            ) : null}
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
                  <p className="hint">
                    Supabase-Konfiguration:{' '}
                    {supabaseConfigStatus.configured
                      ? supabaseConfigStatus.source === 'runtime'
                        ? 'geladen (runtime.json)'
                        : 'geladen (VITE)'
                      : 'fehlt'}
                  </p>
                  <p className="hint">Letzter Sync: {toSyncTimeLabel(devSyncInfo?.lastPushedAt ?? null)}</p>
                  {syncDiagnostics ? (
                    <div className="dev-sync-panel">
                      <p className="hint">
                        Sync Diagnose ({syncDiagnostics.mode}) · {toSyncTimeLabel(syncDiagnostics.atISO)}
                      </p>
                      <p className="hint">
                        Remote gesehen: {syncDiagnostics.remoteEnvelopesSeen} · angewendet:{' '}
                        {syncDiagnostics.remoteEnvelopesApplied}
                      </p>
                      <p className="hint">
                        Snapshot: {syncDiagnostics.snapshotApplied} · Changes: {syncDiagnostics.changeApplied} ·
                        Snapshot-Rescue: {syncDiagnostics.snapshotRescues}
                      </p>
                      <p className="hint">
                        Retry (remote changed): {syncDiagnostics.remoteChangedRetries} · Pending Outbox:{' '}
                        {syncDiagnostics.pendingOutboxCount}
                      </p>
                    </div>
                  ) : null}
                  <div className="pairing-panel">
                    <h3>Geräte koppeln</h3>
                    <div className="data-actions">
                      <button type="button" onClick={handleShowPairQr} disabled={!syncPairCode}>
                        QR-Code anzeigen
                      </button>
                      <button type="button" onClick={handleOpenScanner}>
                        QR scannen
                      </button>
                    </div>
                    <p className="hint">Nur mit Geräten teilen, denen du vertraust.</p>
                    {scannerHint ? <p className="hint">{scannerHint}</p> : null}
                    {syncPairCode ? (
                      <div className="import-panel">
                        <label className="hint" htmlFor="sync-pair-code">Pair Code (mit Token)</label>
                        <textarea id="sync-pair-code" readOnly value={syncPairCode} rows={3} />
                        <button type="button" onClick={() => void handleCopyPairCode()}>
                          Pair Code kopieren
                        </button>
                      </div>
                    ) : null}
                    <div className="import-panel">
                      <label className="hint" htmlFor="sync-pair-import">Pair Code einfügen</label>
                      <textarea
                        id="sync-pair-import"
                        value={syncPairCodeDraft}
                        onChange={(event) => setSyncPairCodeDraft(event.target.value)}
                        rows={3}
                        placeholder='leiser://pair?... oder {"roomId":"...","token":"..."}'
                      />
                      <div className="data-actions">
                        <button type="button" onClick={() => void handlePasteFromClipboard()}>
                          Aus Zwischenablage
                        </button>
                        <button type="button" onClick={() => void handleImportPairCode()} disabled={!syncPairCodeDraft.trim()}>
                          Pairing importieren
                        </button>
                      </div>
                    </div>
                  </div>

                  {showPairQr ? (
                    <div className="pairing-modal-backdrop" role="presentation" onClick={() => setShowPairQr(false)}>
                      <div
                        className="pairing-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Pairing QR-Code"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <h3>Pairing QR-Code</h3>
                        <canvas ref={qrCanvasRef} width={256} height={256} />
                        <p className="hint">Nur mit Geräten teilen, denen du vertraust.</p>
                        <button type="button" onClick={() => setShowPairQr(false)}>
                          Schließen
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {showScanner ? (
                    <div className="pairing-modal-backdrop" role="presentation" onClick={handleScannerCancel}>
                      <div
                        className="pairing-modal pairing-modal--scanner"
                        role="dialog"
                        aria-modal="true"
                        aria-label="QR Scanner"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <h3>QR scannen</h3>
                        <video ref={scannerVideoRef} className="pairing-scanner-video" muted playsInline />
                        <p className="hint">Kamera auf den Pairing-QR-Code halten.</p>
                        <button type="button" onClick={handleScannerCancel}>
                          Abbrechen
                        </button>
                      </div>
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
                      <span className="note-content">
                        <ExpandableNoteText text={note.text} />
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
              todayISO={todayISO}
              yesterdayISO={yesterdayISO}
              onUndoDelete={handleUndoDelete}
              onDelete={handleDeleteDefault}
              endRef={braindumpEndRef}
              onSubmitEntries={handleBraindumpSubmitEntries}
            />
          ) : null}

          {activeTab === 'REVIEW' ? (
            <>
              <div className="section-headline">
                <h2>Review</h2>
                <div className="view-mode-toggle" role="group" aria-label="Review Ansicht">
                  <button
                    type="button"
                    className={reviewLayoutPreference === 'AUTO' ? 'archive-toggle archive-toggle--active' : 'archive-toggle'}
                    onClick={() => setReviewLayoutPreference('AUTO')}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    className={reviewLayoutPreference === 'SINGLE' ? 'archive-toggle archive-toggle--active' : 'archive-toggle'}
                    onClick={() => setReviewLayoutPreference('SINGLE')}
                  >
                    Single
                  </button>
                  <button
                    type="button"
                    className={reviewLayoutPreference === 'LIST' ? 'archive-toggle archive-toggle--active' : 'archive-toggle'}
                    onClick={() => setReviewLayoutPreference('LIST')}
                  >
                    Liste
                  </button>
                </div>
              </div>
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
              ) : resolvedReviewLayout === 'LIST' ? (
                orderedInbox.length === 0 ? (
                  <p className="empty-text">Keine offenen Gedanken.</p>
                ) : (
                  <>
                    {reviewListGroups.map((group) =>
                      group.notes.length > 0 ? (
                        <section key={group.key} className="note-group">
                          <div className="day-divider">{group.label} ({group.notes.length})</div>
                          <ul className="notes-list" aria-label={`Review ${group.label}`}>
                            {group.notes.map((note) => (
                              <li key={note.id} className="note-item note-item--todo">
                                <span className="note-content">
                                  <ExpandableNoteText text={note.text} />
                                  {reviewAgeLabel(getReviewAgeCategory(note)) ? (
                                    <span className={`age-badge age-badge--${getReviewAgeCategory(note).toLowerCase()}`}>
                                      {reviewAgeLabel(getReviewAgeCategory(note))}
                                    </span>
                                  ) : null}
                                  <NoteTypeBadge note={note} />
                                </span>
                                <div className="todo-actions">
                                  <button
                                    type="button"
                                    className="review-btn review-btn--todo review-btn--icon"
                                    onClick={() =>
                                      void handleReviewDecision(note.id, 'TODO', { enableUndo: true, sourceNote: note })
                                    }
                                    aria-label="Als To-Do markieren"
                                    title="To-Do"
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
                                  </button>
                                  <button
                                    type="button"
                                    className="review-btn review-btn--process review-btn--icon"
                                    onClick={() =>
                                      void handleReviewDecision(note.id, 'PROCESS', { enableUndo: true, sourceNote: note })
                                    }
                                    aria-label="In Denken verschieben"
                                    title="Denken"
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
                                  </button>
                                  <button
                                    type="button"
                                    className="review-btn review-btn--discard review-btn--icon"
                                    onClick={() =>
                                      void handleReviewDecision(note.id, 'DISCARD', { enableUndo: true, sourceNote: note })
                                    }
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
                        </section>
                      ) : null,
                    )}
                    <p className="review-meta">Offen: {inboxCount}</p>
                    {inboxCount > inboxNotes.length ? (
                      <p className="hint">Weitere offene Gedanken vorhanden.</p>
                    ) : null}
                  </>
                )
              ) : currentReviewNote ? (
                <article className="review-focus-card" aria-label="Aktueller Gedanke">
                  <div className="review-focus-head">
                    {reviewAgeLabel(currentReviewCategory ?? 'READY') ? (
                      <span className={`age-badge age-badge--${currentReviewCategory?.toLowerCase()}`}>
                        {reviewAgeLabel(currentReviewCategory ?? 'READY')}
                      </span>
                    ) : null}
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
                    {reviewAgeLabel(currentReviewCategory ?? 'READY') ? (
                      <>Kategorie: {reviewAgeLabel(currentReviewCategory ?? 'READY')} · </>
                    ) : null}
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
                            <span className="note-content">
                              <ExpandableNoteText text={note.text} />
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
              <h2>Gedanken ({processCount})</h2>
              <button
                type="button"
                className="archive-toggle"
                onClick={() => setShowArchive((prev) => !prev)}
              >
                {showArchive ? `Archiv ausblenden (${thinkingArchiveCount})` : `Archiv anzeigen (${thinkingArchiveCount})`}
              </button>
            </div>
            {processCount === 0 ? <p className="empty-text">Keine offenen Gedanken.</p> : null}
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
                {thinkingArchivedNotes.length === 0 ? <p className="empty-text">Archiv ist leer.</p> : null}
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
                {thinkingArchiveCount >= 50 ? (
                  <p className="hint">Nur die letzten 50 angezeigt.</p>
                ) : null}
              </>
            ) : null}
            </>
          ) : null}

          {activeTab === 'TODO' ? (
            <>
            <div className="section-headline section-headline--todo">
              <h2>To-Do ({visibleTodoNotes.length}{todoStarOnly ? ` / ${todoNotes.length}` : ''})</h2>
              <div className="view-mode-toggle">
                <button
                  type="button"
                  className={todoStarOnly ? 'archive-toggle archive-toggle--active' : 'archive-toggle'}
                  onClick={() => setTodoStarOnly((prev) => !prev)}
                >
                  {todoStarOnly ? 'Alle' : 'Stern'}
                </button>
                <button
                  type="button"
                  className={showTodoArchive ? 'archive-toggle archive-toggle--active' : 'archive-toggle'}
                  onClick={() => setShowTodoArchive((prev) => !prev)}
                >
                  {showTodoArchive ? `Archiv ausblenden (${todoArchiveCount})` : `Archiv anzeigen (${todoArchiveCount})`}
                </button>
              </div>
            </div>
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
            {todoNotes.length > 0 && visibleTodoNotes.length === 0 ? (
              <p className="empty-text">Keine To-Dos mit Stern.</p>
            ) : null}
            {todoGroups.map((group) => (
              <section key={group.dayISO} className="note-group">
                <div className="day-divider">{group.label}</div>
                <ul className="notes-list" aria-label={`To-Do ${group.label}`}>
                  {group.notes.map((note) => (
                    <TodoNoteRow
                      key={note.id}
                      note={note}
                      onToggleStar={handleTodoToggleStar}
                      onDone={handleTodoDone}
                      onBack={handleTodoBack}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {showTodoArchive ? (
              <>
                <h3 className="archive-title">Archiv</h3>
                {todoArchivedNotes.length === 0 ? <p className="empty-text">Archiv ist leer.</p> : null}
                {archivedTodoGroups.map((group) => (
                  <section key={group.dayISO} className="note-group">
                    <div className="day-divider">{group.label}</div>
                    <ul className="notes-list" aria-label={`To-Do Archiv ${group.label}`}>
                      {group.notes.map((note) => (
                        <ArchivedTodoNoteRow
                          key={note.id}
                          note={note}
                          onBackToTodo={handleArchivedBackToTodo}
                          onDiscard={handleThinkingDiscard}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
                {todoArchiveCount >= 50 ? (
                  <p className="hint">Nur die letzten 50 angezeigt.</p>
                ) : null}
              </>
            ) : null}
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
