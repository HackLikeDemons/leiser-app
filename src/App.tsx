import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import QRCode from 'qrcode'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  DEFAULT_SYNC_ROOM_ID,
  addNote,
  clearClientLocalData,
  clearInboxSeen,
  countNotesByStatus,
  deleteNote,
  getSyncDebugInfo,
  getSyncState,
  getSyncPairCode,
  listPendingOutboxChanges,
  listInboxNotes,
  listAutoArchiveCandidates,
  listNotesByStatus,
  listRecentActiveNotes,
  listTodoNotes,
  setSyncEnabled,
  updateSyncState,
  updateNoteArchiveBucket,
  updateNoteContext,
  updateNoteStarred,
  updateNoteStatus,
} from './lib/dbNotes'
import { buildBackupData, importBackupJson, type ImportMode, type ImportReport } from './lib/backup'
import { getLocalDayISO } from './lib/date'
import type { ContextTag, Note, NoteStatus, NoteType } from './lib/types'
import { AppShell } from './app/AppShell'
import { FlowHero } from './app/FlowHero'
import { FooterProvider } from './app/FooterContext'
import { DataScreen } from './app/data/DataScreen'
import type { DevSyncInfo } from './app/data/SyncPanel'
import { getSupabaseRuntimeConfig } from './lib/runtimeConfig'
import { startSyncEngine, syncNow, type SyncDiagnostics, type SyncUiStatus } from './lib/syncEngine'

type TabKey = 'BRAINDUMP' | 'REVIEW' | 'THINKING' | 'TODO' | 'DATA'
const SOFT_CHAR_LIMIT = 200
const REVIEW_LIMIT = 50
const FRESH_HOURS = 12
const OVERDUE_DAYS = 3
const AUTOSCROLL_NEAR_BOTTOM_PX = 80
const BRAINDUMP_FETCH_LIMIT = 300
const AUTO_ARCHIVE_DAYS = 90
const AUTO_ARCHIVE_BATCH_LIMIT = 100
const AUTO_ARCHIVE_LAST_RUN_KEY = 'leiser:auto-archive-last-run-day'
const SYNC_ID_STORAGE_KEY = 'leiser-sync-id'
const SYNC_TOKEN_STORAGE_KEY = 'leiser-sync-token'
const SYNC_KEY_STORAGE_KEY = 'leiser-sync-key'
const SHOW_DEBUG_INFO_STORAGE_KEY = 'leiser:show-debug-info'
const LAST_BACKUP_AT_STORAGE_KEY = 'leiser:last-backup-at'
const RELOAD_AFTER_INACTIVITY_MS = 20 * 60 * 1000
const FEEDBACK_VISIBILITY_MS = 3000
const SW_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000
const BACKUP_OVERDUE_DAYS = 7

type PairingPayloadV1 = {
  v: 1
  roomId: string
  token: string
  key?: string
}

type ReviewAgeCategory = 'OVERDUE' | 'READY' | 'FRESH'
type LastAction = {
  noteId: string
  prevStatus: NoteStatus
  newStatus: NoteStatus
  at: number
}
type CaptureFeedback = {
  id: number
  text: string
}

type ContextFilter = '' | '__none' | ContextTag
type ContextGroup = {
  contextKey: '__none' | ContextTag
  label: string
  notes: Note[]
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

function isTypingInInput(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true
  }
  return target.isContentEditable
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

function toBackupTimeLabel(isoTimestamp: string | null) {
  if (!isoTimestamp) {
    return 'noch keines'
  }
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) {
    return 'noch keines'
  }
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function maskSecret(value: string | null) {
  if (!value) {
    return null
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

function daysBetween(dateA: Date, dateB: Date) {
  const a = new Date(dateA)
  const b = new Date(dateB)
  a.setHours(12, 0, 0, 0)
  b.setHours(12, 0, 0, 0)
  const diffMs = Math.abs(a.getTime() - b.getTime())
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

function noteTypeLabel(type: NoteType) {
  if (type === 'TASK') {
    return 'Aufgabe'
  }
  return null
}

const CONTEXT_OPTIONS: Array<{ value: ContextTag; label: string }> = [
  { value: 'arbeit', label: 'Arbeit' },
  { value: 'familie', label: 'Familie' },
  { value: 'finanzen', label: 'Finanzen' },
  { value: 'freunde', label: 'Freunde' },
  { value: 'gesundheit', label: 'Gesundheit' },
  { value: 'haushalt', label: 'Haushalt' },
  { value: 'privat', label: 'Privat' },
  { value: 'projekt', label: 'Projekt' },
]

function contextLabel(context: ContextTag) {
  const match = CONTEXT_OPTIONS.find((option) => option.value === context)
  return match?.label ?? context
}

function contextGroupLabel(context: '__none' | ContextTag) {
  if (context === '__none') {
    return 'Ohne Bereich'
  }
  return contextLabel(context)
}

function matchesContextFilter(note: Note, filter: ContextFilter) {
  if (!filter) {
    return true
  }
  if (filter === '__none') {
    return !note.context
  }
  return note.context === filter
}

function groupNotesByContext(notes: Note[], noteSort: (a: Note, b: Note) => number): ContextGroup[] {
  const grouped = new Map<'__none' | ContextTag, Note[]>()
  for (const note of notes) {
    const key: '__none' | ContextTag = note.context ?? '__none'
    const existing = grouped.get(key)
    if (existing) {
      existing.push(note)
    } else {
      grouped.set(key, [note])
    }
  }

  const groups: ContextGroup[] = Array.from(grouped.entries()).map(([contextKey, groupedNotes]) => ({
    contextKey,
    label: contextGroupLabel(contextKey),
    notes: [...groupedNotes].sort(noteSort),
  }))

  groups.sort((a, b) => a.label.localeCompare(b.label, 'de-DE'))
  return groups
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

function todoActionLabel(status: NoteStatus) {
  if (status === 'ARCHIVE') return 'Als erledigt markiert.'
  if (status === 'INBOX') return 'Zurück in Inbox verschoben.'
  return 'Handlung aktualisiert.'
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

const BraindumpList = memo(function BraindumpList({
  captureFeedback,
  onSubmitEntries,
}: {
  captureFeedback: CaptureFeedback | null
  onSubmitEntries: (entries: string[]) => Promise<void>
}) {
  return (
    <>
      <section className="braindump-hero" aria-label="Braindump Einführung">
        <h2>Lass es raus</h2>
      </section>
      {captureFeedback ? (
        <p key={captureFeedback.id} className="braindump-capture-feedback" role="status" aria-live="polite">
          {captureFeedback.text}
        </p>
      ) : null}
      <BraindumpComposer onSubmitEntries={onSubmitEntries} />
    </>
  )
})

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
  onBack,
}: {
  note: Note
  onArchive: (id: string) => void
  onTodo: (id: string) => void
  onBack: (id: string) => void
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
          aria-label="Zu Handlungen verschieben"
          title="Zu Handlungen"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 7h10M9 12h10M9 17h10M4 7l1.2 1.2L7 6M4 12l1.2 1.2L7 11M4 17l1.2 1.2L7 16"
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
          className="review-btn review-btn--back review-btn--icon"
          onClick={() => onBack(note.id)}
          aria-label="Zurück zu Sortieren"
          title="Zurück zu Sortieren"
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
          aria-label="Endgültig löschen"
          title="Endgültig löschen"
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
          aria-label="Zurück zu Handlungen"
          title="Zurück zu Handlungen"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 7h10M9 12h10M9 17h10M4 7l1.2 1.2L7 6M4 12l1.2 1.2L7 11M4 17l1.2 1.2L7 16"
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
          aria-label="Endgültig löschen"
          title="Endgültig löschen"
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
  const [isDictating, setIsDictating] = useState(false)
  const [dictationError, setDictationError] = useState('')
  const composerRef = useRef<HTMLFormElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const latestTextRef = useRef(text)
  const dictationAutoSubmitOnEndRef = useRef(false)
  const recognitionRef = useRef<{
    stop: () => void
  } | null>(null)

  const supportsDictation = useMemo(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  }, [])
  const browserHints = useMemo(() => {
    if (typeof navigator === 'undefined') {
      return { isEdge: false, isSafari: false }
    }
    const ua = navigator.userAgent
    const isEdge = /\bEdg\//.test(ua)
    const isSafari = /\bSafari\//.test(ua) && !/\bChrom(e|ium)\//.test(ua) && !isEdge
    return { isEdge, isSafari }
  }, [])

  const submit = useCallback(async (entries: string[]) => {
    const cleaned = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    if (cleaned.length === 0) {
      return
    }
    if (recognitionRef.current) {
      dictationAutoSubmitOnEndRef.current = false
      recognitionRef.current.stop()
      recognitionRef.current = null
      setIsDictating(false)
    }
    await onSubmitEntries(cleaned)
    setText('')
    setFlashInput(true)
    window.setTimeout(() => setFlashInput(false), 120)
    if (!(typeof window !== 'undefined' && window.visualViewport)) {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [onSubmitEntries])

  const handleTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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

  const stopDictation = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsDictating(false)
  }, [])

  const probeMicrophoneAccess = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return true
    }
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      return true
    } catch {
      return false
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const startDictation = useCallback(() => {
    if (!supportsDictation || typeof window === 'undefined') {
      setDictationError('Diktieren wird auf diesem Gerät nicht unterstützt.')
      return
    }
    const prefix = text.trim().length > 0 ? `${text.trim()} ` : ''
    const RecognitionCtor = (window as Window & {
      webkitSpeechRecognition?: new () => {
        lang: string
        continuous: boolean
        interimResults: boolean
        onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
        onerror: (() => void) | null
        onend: (() => void) | null
        start: () => void
        stop: () => void
      }
      SpeechRecognition?: new () => {
        lang: string
        continuous: boolean
        interimResults: boolean
        onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
        onerror: (() => void) | null
        onend: (() => void) | null
        start: () => void
        stop: () => void
      }
    }).webkitSpeechRecognition
      ?? (window as Window & {
        SpeechRecognition?: new () => {
          lang: string
          continuous: boolean
          interimResults: boolean
          onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
          onerror: (() => void) | null
          onend: (() => void) | null
          start: () => void
          stop: () => void
        }
      }).SpeechRecognition

    if (!RecognitionCtor) {
      setDictationError('Diktieren wird auf diesem Gerät nicht unterstützt.')
      return
    }

    const recognition = new RecognitionCtor()
    setDictationError('')
    const preferredLang = navigator.language?.trim() || 'de-DE'
    recognition.lang = preferredLang.includes('-') ? preferredLang : `${preferredLang}-${preferredLang.toUpperCase()}`
    recognition.continuous = !browserHints.isEdge
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let transcript = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? ''
      }
      const nextText = `${prefix}${transcript}`.trimStart()
      latestTextRef.current = nextText
      setText(nextText)
    }
    recognition.onerror = (event?: { error?: string }) => {
      const errorCode = event?.error ?? ''
      if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
        if (!window.isSecureContext) {
          setDictationError('Spracherkennung braucht eine sichere Verbindung (HTTPS oder localhost).')
        } else if (browserHints.isEdge) {
          // Probe actual mic permission only after recognition error, to keep start()
          // inside the direct user gesture path (important for Chromium/Edge).
          void probeMicrophoneAccess().then((hasMicAccess) => {
            setDictationError(
              hasMicAccess
                ? `Edge-Spracherkennung wurde blockiert (${errorCode || 'unknown'}). Bitte Seite neu laden und erneut klicken.`
                : 'Mikrofonzugriff blockiert. Bitte in Edge für diese Seite erlauben.',
            )
          })
        } else if (browserHints.isSafari) {
          setDictationError('Safari-Spracherkennung wurde blockiert. Bitte Siri/Diktat-Einstellungen prüfen.')
        } else {
          setDictationError('Spracherkennung wurde blockiert. Bitte Browser-Berechtigungen prüfen.')
        }
      } else if (errorCode === 'network') {
        setDictationError('Spracherkennung derzeit nicht erreichbar. Bitte erneut versuchen.')
      } else if (errorCode === 'no-speech') {
        setDictationError('Keine Sprache erkannt. Bitte erneut versuchen.')
      } else {
        setDictationError('Diktieren konnte nicht gestartet werden.')
      }
      setIsDictating(false)
      dictationAutoSubmitOnEndRef.current = false
      recognitionRef.current = null
    }
    recognition.onend = () => {
      setIsDictating(false)
      recognitionRef.current = null
      if (!dictationAutoSubmitOnEndRef.current) {
        return
      }
      dictationAutoSubmitOnEndRef.current = false
      const latestFromInput = inputRef.current?.value ?? ''
      const textToSave = latestFromInput.trim().length > 0 ? latestFromInput : latestTextRef.current
      void submit([textToSave])
    }
    try {
      recognition.start()
      dictationAutoSubmitOnEndRef.current = true
      recognitionRef.current = recognition
      setIsDictating(true)
    } catch {
      dictationAutoSubmitOnEndRef.current = false
      recognitionRef.current = null
      setIsDictating(false)
      setDictationError(
        browserHints.isEdge
          ? 'Diktieren konnte nicht gestartet werden. Bitte Edge-Mikrofonrechte prüfen.'
          : 'Diktieren konnte nicht gestartet werden. Bitte Browser-Berechtigungen prüfen.',
      )
    }
  }, [browserHints.isEdge, browserHints.isSafari, probeMicrophoneAccess, submit, supportsDictation, text])

  useEffect(() => {
    latestTextRef.current = text
  }, [text])

  useEffect(() => {
    return () => {
      dictationAutoSubmitOnEndRef.current = false
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
  }, [])

  return (
    <div className="app-content">
      <form className="capture-form braindump-composer" onSubmit={handleSubmit} ref={composerRef}>
        <textarea
          rows={2}
          ref={inputRef}
          className={flashInput ? 'capture-textarea capture-textarea--flash' : 'capture-textarea'}
          placeholder="Gedanken festhalten..."
          value={text}
          onChange={(event) => {
            latestTextRef.current = event.target.value
            setText(event.target.value)
          }}
          onKeyDown={handleTextKeyDown}
        />
        <div className="capture-actions">
          <div className="capture-meta-row">
            <small className={text.length > SOFT_CHAR_LIMIT ? 'counter counter--warning' : 'counter'}>
              {text.length} / {SOFT_CHAR_LIMIT}
            </small>
            <small className="capture-hint">Enter: speichern</small>
          </div>
          <button
            type="button"
            className={isDictating ? 'capture-dictate capture-dictate--active capture-dictate--icon' : 'capture-dictate capture-dictate--icon'}
            onClick={isDictating ? stopDictation : startDictation}
            aria-label={isDictating ? 'Diktieren stoppen' : 'Diktieren starten'}
            title={isDictating ? 'Diktieren stoppen' : 'Diktieren starten'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0v-5a3 3 0 0 1 3-3ZM6 11.5a6 6 0 1 0 12 0M12 19v2.5M9 21.5h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        {dictationError ? <small className="soft-limit-hint">{dictationError}</small> : null}
        {text.length > SOFT_CHAR_LIMIT ? (
          <small className="soft-limit-hint">Vielleicht sind das mehrere Gedanken.</small>
        ) : null}
      </form>
    </div>
  )
}

function BraindumpPage({
  captureFeedback,
  endRef,
  onSubmitEntries,
}: {
  captureFeedback: CaptureFeedback | null
  endRef: RefObject<HTMLDivElement | null>
  onSubmitEntries: (entries: string[]) => Promise<void>
}) {
  return (
    <>
      <BraindumpList
        captureFeedback={captureFeedback}
        onSubmitEntries={onSubmitEntries}
      />
      <div ref={endRef} />
    </>
  )
}

function AppContent() {
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker registration failed', error)
    },
  })
  const [activeTab, setActiveTab] = useState<TabKey>('BRAINDUMP')
  const [braindumpNotes, setBraindumpNotes] = useState<Note[]>([])
  const [inboxNotes, setInboxNotes] = useState<Note[]>([])
  const [processNotes, setProcessNotes] = useState<Note[]>([])
  const [processCount, setProcessCount] = useState(0)
  const [thinkingContextFilter, setThinkingContextFilter] = useState<ContextFilter>('')
  const [todoNotes, setTodoNotes] = useState<Note[]>([])
  const [todoStarOnly, setTodoStarOnly] = useState(false)
  const [todoContextFilter, setTodoContextFilter] = useState<ContextFilter>('')
  const [archivedNotes, setArchivedNotes] = useState<Note[]>([])
  const [showArchive, setShowArchive] = useState(false)
  const [showTodoArchive, setShowTodoArchive] = useState(false)
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('MERGE')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [showDebugInfo, setShowDebugInfo] = useState(false)
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => localStorage.getItem(LAST_BACKUP_AT_STORAGE_KEY))
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
  const [staleReviewMode, setStaleReviewMode] = useState(false)
  const [staleQueueIds, setStaleQueueIds] = useState<string[]>([])
  const [staleReviewTotal, setStaleReviewTotal] = useState(0)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [lastTodoAction, setLastTodoAction] = useState<LastAction | null>(null)
  const [dismissedUpdateNotice, setDismissedUpdateNotice] = useState(false)
  const [undoBusy, setUndoBusy] = useState(false)
  const [todoUndoBusy, setTodoUndoBusy] = useState(false)
  const [braindumpCaptureFeedback, setBraindumpCaptureFeedback] = useState<CaptureFeedback | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const undoTimeoutRef = useRef<number | null>(null)
  const todoUndoTimeoutRef = useRef<number | null>(null)
  const braindumpCaptureFeedbackTimeoutRef = useRef<number | null>(null)
  const braindumpCaptureFeedbackSeqRef = useRef(0)
  const transientInfoTimeoutRef = useRef<number | null>(null)
  const mainScrollRef = useRef<HTMLElement | null>(null)
  const braindumpEndRef = useRef<HTMLDivElement | null>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null)
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const nextAutoScrollBehaviorRef = useRef<ScrollBehavior>('auto')
  const hiddenAtRef = useRef<number | null>(null)
  const swReloadedRef = useRef(false)

  const clearTransientInfoTimeout = () => {
    if (transientInfoTimeoutRef.current !== null) {
      window.clearTimeout(transientInfoTimeoutRef.current)
      transientInfoTimeoutRef.current = null
    }
  }

  const showTransientInfo = useCallback((message: string) => {
    setInfo(message)
    clearTransientInfoTimeout()
    transientInfoTimeoutRef.current = window.setTimeout(() => {
      setInfo((current) => (current === message ? '' : current))
      transientInfoTimeoutRef.current = null
    }, FEEDBACK_VISIBILITY_MS)
  }, [])

  const backupOverdue = useMemo(() => {
    if (!lastBackupAt) {
      return true
    }
    const backupDate = new Date(lastBackupAt)
    if (Number.isNaN(backupDate.getTime())) {
      return true
    }
    const elapsedMs = Date.now() - backupDate.getTime()
    return elapsedMs >= BACKUP_OVERDUE_DAYS * 24 * 60 * 60 * 1000
  }, [lastBackupAt])

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
      const [braindump, inbox, process, processTotal, todo, archived] = await Promise.all([
        listRecentActiveNotes(BRAINDUMP_FETCH_LIMIT),
        listInboxNotes(REVIEW_LIMIT),
        listNotesByStatus('PROCESS', 200),
        countNotesByStatus('PROCESS'),
        listTodoNotes(200),
        listNotesByStatus('ARCHIVE', 50),
      ])
      setBraindumpNotes(braindump)
      setInboxNotes(inbox)
      setProcessNotes(process)
      setProcessCount(processTotal)
      setTodoNotes(todo)
      setArchivedNotes(archived)
      const syncInfo = await getSyncDebugInfo(activeRoomId)
      setSyncEnabledState(syncInfo.isEnabled)
      setSyncPairCode(await getSyncPairCode(activeRoomId))
      setDevSyncInfo(syncInfo)
    } catch {
      setError('Daten konnten nicht geladen werden.')
    }
  }, [syncRoomId])

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
    localStorage.setItem(SYNC_ID_STORAGE_KEY, syncRoomId)
  }, [syncRoomId])

  useEffect(() => {
    if (needRefresh) {
      setDismissedUpdateNotice(false)
    }
  }, [needRefresh])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (isTypingInInput(event.target)) {
        return
      }
      if (event.key === '1') {
        setActiveTab('BRAINDUMP')
        event.preventDefault()
      } else if (event.key === '2') {
        setActiveTab('REVIEW')
        event.preventDefault()
      } else if (event.key === '3') {
        setActiveTab('THINKING')
        event.preventDefault()
      } else if (event.key === '4') {
        setActiveTab('TODO')
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return
    }

    let intervalId: number | null = null

    const checkForSwUpdates = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        await registration?.update()
      } catch {
        // Best effort only.
      }
    }

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void checkForSwUpdates()
      }
    }

    const handleControllerChange = () => {
      if (swReloadedRef.current) {
        return
      }
      swReloadedRef.current = true
      window.location.reload()
    }

    void checkForSwUpdates()
    intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkForSwUpdates()
      }
    }, SW_UPDATE_CHECK_INTERVAL_MS)

    document.addEventListener('visibilitychange', handleVisibilityOrFocus)
    window.addEventListener('focus', handleVisibilityOrFocus)
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

    return () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      window.removeEventListener('focus', handleVisibilityOrFocus)
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [])

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
      const storedRoomId = localStorage.getItem(SYNC_ID_STORAGE_KEY)?.trim() ?? ''
      const currentRoomId = syncRoomId.trim()
      const nextRoomId = nextEnabled
        ? storedRoomId && storedRoomId !== DEFAULT_SYNC_ROOM_ID
          ? storedRoomId
          : currentRoomId && currentRoomId !== DEFAULT_SYNC_ROOM_ID
            ? currentRoomId
            : ''
        : syncRoomId
      if (nextEnabled && !nextRoomId) {
        setError('Kein Sync-Raum hinterlegt. Erstelle einen neuen Sync-Raum oder importiere einen Pairing-Code.')
        return
      }
      setSyncRoomId(nextRoomId)
      const next = await setSyncEnabled(nextRoomId, nextEnabled)
      setSyncEnabledState(next.isEnabled)
      showTransientInfo(next.isEnabled ? 'Sync aktiviert.' : 'Sync deaktiviert.')
      await refreshAll(nextRoomId)
    } catch {
      setError('Sync-Status konnte nicht geändert werden.')
    }
  }, [refreshAll, showTransientInfo, syncEnabled, syncRoomId])

  const handleCreateSyncRoom = useCallback(async () => {
    setError('')
    if (syncEnabled) {
      setError('Sync zuerst deaktivieren, bevor ein neuer Sync-Raum erstellt wird.')
      return
    }
    const storedRoomId = localStorage.getItem(SYNC_ID_STORAGE_KEY)?.trim() ?? ''
    const currentRoomId = syncRoomId.trim()
    const existingRoomId =
      storedRoomId && storedRoomId !== DEFAULT_SYNC_ROOM_ID
        ? storedRoomId
        : currentRoomId && currentRoomId !== DEFAULT_SYNC_ROOM_ID
          ? currentRoomId
          : ''
    const warningMessage = existingRoomId
      ? 'Achtung: Du bist bereits mit einem Sync-Raum verbunden. Wenn du jetzt eine neue Sync-ID erstellst, wird ein neuer leerer Raum verwendet und dieses Gerät fällt aus dem bisherigen Sync-Verbund. Zugriff auf die bisherigen Daten bekommst du nur mit dem alten Pairing-Code oder einem Backup. Wirklich neuen Sync-Raum erstellen?'
      : 'Achtung: Du erstellst eine neue Sync-ID. Teile danach den neuen Pairing-Code mit deinen Geräten, sonst synchronisieren sie nicht. Wirklich fortfahren?'
    if (!window.confirm(warningMessage)) {
      return
    }
    try {
      const roomId = crypto.randomUUID()
      localStorage.setItem(SYNC_ID_STORAGE_KEY, roomId)
      setSyncRoomId(roomId)
      await updateSyncState(roomId, { isEnabled: false, lastError: null })
      await refreshAll(roomId)
      showTransientInfo('Neuer Sync-Raum erstellt. Du kannst jetzt Sync aktivieren oder den Pairing-Code teilen.')
    } catch {
      setError('Neuer Sync-Raum konnte nicht erstellt werden.')
    }
  }, [refreshAll, showTransientInfo, syncEnabled, syncRoomId])

  const handleWipeClient = useCallback(async () => {
    setError('')
    const confirmed = window.confirm(
      'Achtung: Damit werden alle lokalen Einträge auf diesem Gerät gelöscht und Sync wird getrennt. Daten im Sync-Server und auf anderen Geräten bleiben erhalten. Fortfahren?',
    )
    if (!confirmed) {
      return
    }
    try {
      await clearClientLocalData()
      await updateSyncState(syncRoomId, {
        isEnabled: false,
        syncToken: null,
        lastError: null,
        lastPulledSeq: 0,
        lastPushedAt: null,
      })
      localStorage.removeItem(SYNC_ID_STORAGE_KEY)
      localStorage.removeItem(SYNC_TOKEN_STORAGE_KEY)
      localStorage.removeItem(SYNC_KEY_STORAGE_KEY)
      setShowPairQr(false)
      setShowScanner(false)
      setSyncRoomId(DEFAULT_SYNC_ROOM_ID)
      setSyncEnabledState(false)
      setSyncPairCode(null)
      setSyncDiagnostics(null)
      setSyncError(null)
      setInfo('')
      await refreshAll(DEFAULT_SYNC_ROOM_ID)
      showTransientInfo('Client bereinigt. Dieses Gerät ist jetzt lokal leer und nicht mehr gekoppelt.')
    } catch {
      setError('Client konnte nicht bereinigt werden.')
    }
  }, [refreshAll, showTransientInfo, syncRoomId])

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
    } catch {
      setError('Sync now fehlgeschlagen.')
    } finally {
      setSyncNowBusy(false)
    }
  }, [refreshAll, syncRoomId])

  const handleCopySyncProtocol = useCallback(async () => {
    setError('')
    try {
      const [state, debugInfo, pendingOutbox] = await Promise.all([
        getSyncState(syncRoomId),
        getSyncDebugInfo(syncRoomId),
        listPendingOutboxChanges(syncRoomId, 200),
      ])

      const outboxSummary = pendingOutbox.map((entry) => ({
        changeId: entry.changeId,
        noteId: entry.noteId,
        createdAt: entry.createdAt,
        sentAt: entry.sentAt,
        attemptCount: entry.attemptCount,
        bytesLength:
          entry.bytes instanceof ArrayBuffer
            ? entry.bytes.byteLength
            : entry.bytes && 'byteLength' in entry.bytes
              ? Number((entry.bytes as { byteLength?: unknown }).byteLength) || 0
              : 0,
      }))

      const protocol = {
        timestamp: new Date().toISOString(),
        app: {
          tab: activeTab,
          syncRoomId,
          syncEnabled,
          syncStatus,
          syncError,
        },
        syncState: {
          roomId: state.roomId,
          isEnabled: state.isEnabled,
          lastPulledSeq: state.lastPulledSeq,
          lastPushedAt: state.lastPushedAt,
          lastError: state.lastError,
          syncTokenMasked: maskSecret(state.syncToken),
        },
        syncDebug: {
          deviceId: debugInfo.deviceId,
          roomId: debugInfo.roomId,
          lastPulledSeq: debugInfo.lastPulledSeq,
          lastPushedAt: debugInfo.lastPushedAt,
          isEnabled: debugInfo.isEnabled,
          syncTokenPresent: Boolean(debugInfo.syncToken),
        },
        diagnostics: syncDiagnostics,
        localStorage: {
          syncId: localStorage.getItem(SYNC_ID_STORAGE_KEY),
          syncTokenMasked: maskSecret(localStorage.getItem(SYNC_TOKEN_STORAGE_KEY)),
          syncKeyMasked: maskSecret(localStorage.getItem(SYNC_KEY_STORAGE_KEY)),
          showDebugInfo: localStorage.getItem(SHOW_DEBUG_INFO_STORAGE_KEY),
        },
        dataCounts: {
          inbox: inboxNotes.length,
          thinking: processCount,
          todo: todoNotes.length,
          archived: archivedNotes.length,
        },
        outbox: {
          pendingCount: outboxSummary.length,
          items: outboxSummary,
        },
        environment: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          online: navigator.onLine,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          url: window.location.href,
        },
      }

      await navigator.clipboard.writeText(JSON.stringify(protocol, null, 2))
      showTransientInfo('Sync-Protokoll kopiert.')
    } catch {
      setError('Sync-Protokoll konnte nicht kopiert werden.')
    }
  }, [
    activeTab,
    archivedNotes.length,
    inboxNotes.length,
    processCount,
    showTransientInfo,
    syncDiagnostics,
    syncEnabled,
    syncError,
    syncRoomId,
    syncStatus,
    todoNotes.length,
  ])

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
      // Always reset seen cache on pairing to force full hydration from the target room.
      await clearInboxSeen()
      await refreshAll(payload.roomId)

      try {
        await runSyncNowForRoom(payload.roomId)
        showTransientInfo('Gerät gekoppelt. Sync erfolgreich.')
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
    [refreshAll, runSyncNowForRoom, showTransientInfo, syncRoomId],
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
      showTransientInfo('Pair Code kopiert.')
    } catch {
      setError('Kopieren fehlgeschlagen.')
    }
  }, [showTransientInfo, syncPairCode])

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
    if (!showPairQr) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      setShowPairQr(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showPairQr])

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
  const overdueReviewCount = useMemo(
    () => orderedInbox.filter((note) => getReviewAgeCategory(note) === 'OVERDUE').length,
    [orderedInbox],
  )
  const supabaseConfigStatus = useMemo(() => getSupabaseRuntimeConfig(), [])

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
          const nextFeedback: CaptureFeedback = {
            id: braindumpCaptureFeedbackSeqRef.current + 1,
            text: 'Gedanke gespeichert.',
          }
          braindumpCaptureFeedbackSeqRef.current = nextFeedback.id
          setBraindumpCaptureFeedback(nextFeedback)
          clearBraindumpCaptureFeedbackTimeout()
          braindumpCaptureFeedbackTimeoutRef.current = window.setTimeout(() => {
            setBraindumpCaptureFeedback((current) => (current?.id === nextFeedback.id ? null : current))
            braindumpCaptureFeedbackTimeoutRef.current = null
          }, FEEDBACK_VISIBILITY_MS)
        }
        void refreshAll()
      } catch {
        setError('Notiz konnte nicht gespeichert werden.')
      }
    },
    [isNearBottom, refreshAll],
  )

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

  const clearBraindumpCaptureFeedbackTimeout = () => {
    if (braindumpCaptureFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(braindumpCaptureFeedbackTimeoutRef.current)
      braindumpCaptureFeedbackTimeoutRef.current = null
    }
  }

  useEffect(
    () => () => {
      clearUndoTimeout()
      clearTodoUndoTimeout()
      clearBraindumpCaptureFeedbackTimeout()
      clearTransientInfoTimeout()
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
      if (status === 'DISCARD') {
        clearUndoTimeout()
        setLastAction(null)
        await deleteNote(id)
        await refreshAll()
        return
      }

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
      clearUndoTimeout()
      setLastAction(null)
      await refreshAll()
    } catch {
      setError('Rückgängig fehlgeschlagen.')
    } finally {
      setUndoBusy(false)
    }
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
      const exportedAt = new Date().toISOString()
      setLastBackupAt(exportedAt)
      localStorage.setItem(LAST_BACKUP_AT_STORAGE_KEY, exportedAt)
      showTransientInfo('Backup erzeugt.')
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
      showTransientInfo('Backup erfolgreich importiert.')
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

  const showUpdateNotice = needRefresh && !dismissedUpdateNotice
  const visibleProcessNotes = useMemo(() => {
    return processNotes.filter((note) => matchesContextFilter(note, thinkingContextFilter))
  }, [processNotes, thinkingContextFilter])

  const thinkingGroups = useMemo(() => {
    return groupNotesByContext(visibleProcessNotes, (a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
      if (byUpdated !== 0) {
        return byUpdated
      }
      return b.createdAt.localeCompare(a.createdAt)
    })
  }, [visibleProcessNotes])
  const thinkingArchivedNotes = useMemo(
    () =>
      archivedNotes.filter(
        (note) => note.archiveBucket === 'THINKING' || (note.archiveBucket == null && note.type !== 'TASK'),
      ),
    [archivedNotes],
  )
  const visibleThinkingArchivedNotes = useMemo(() => {
    return thinkingArchivedNotes.filter((note) => matchesContextFilter(note, thinkingContextFilter))
  }, [thinkingArchivedNotes, thinkingContextFilter])
  const todoArchivedNotes = useMemo(
    () =>
      archivedNotes.filter(
        (note) => note.archiveBucket === 'TODO' || (note.archiveBucket == null && note.type === 'TASK'),
      ),
    [archivedNotes],
  )
  const thinkingArchiveCount = visibleThinkingArchivedNotes.length
  const visibleTodoArchivedNotes = useMemo(() => {
    return todoArchivedNotes.filter((note) => matchesContextFilter(note, todoContextFilter))
  }, [todoArchivedNotes, todoContextFilter])
  const todoArchiveCount = visibleTodoArchivedNotes.length
  const archivedThinkingGroups = useMemo(() => {
    return groupNotesByContext(visibleThinkingArchivedNotes, (a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
      if (byUpdated !== 0) {
        return byUpdated
      }
      return b.createdAt.localeCompare(a.createdAt)
    })
  }, [visibleThinkingArchivedNotes])
  const archivedTodoGroups = useMemo(() => {
    return groupNotesByContext(visibleTodoArchivedNotes, (a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
      if (byUpdated !== 0) {
        return byUpdated
      }
      return b.createdAt.localeCompare(a.createdAt)
    })
  }, [visibleTodoArchivedNotes])

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
        setError('Alte Handlung konnte nicht aktualisiert werden.')
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
        setError('Handlung konnte nicht aktualisiert werden.')
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
        showTransientInfo('Handlung ins Archiv verschoben.')
        await refreshAll()
      } catch {
        clearTodoUndoTimeout()
        setLastTodoAction(null)
        setError('Handlung konnte nicht aktualisiert werden.')
      }
    },
    [todoNotes, refreshAll, showTransientInfo, startTodoUndoWindow],
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

  const handleReviewContextChange = useCallback(
    async (id: string, context: ContextTag | undefined) => {
      setError('')
      try {
        await updateNoteContext(id, context)
        await refreshAll()
      } catch {
        setError('Bereich konnte nicht aktualisiert werden.')
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
      setError('Rückgängig für Handlung fehlgeschlagen.')
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
  const handleThinkingBackToReview = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'INBOX')
    },
    [handleReviewDecision],
  )
  const handleArchivedBackToThinking = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'PROCESS')
    },
    [handleReviewDecision],
  )
  const handleThinkingArchiveDiscard = useCallback(
    async (id: string) => {
      setError('')
      try {
        await deleteNote(id)
        if (thinkingArchiveCount <= 1) {
          setShowArchive(false)
        }
        showTransientInfo('Gedanke endgültig gelöscht.')
        await refreshAll()
      } catch {
        setError('Gedanke konnte nicht gelöscht werden.')
      }
    },
    [refreshAll, showTransientInfo, thinkingArchiveCount],
  )
  const handleArchivedBackToTodo = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'TODO')
    },
    [handleReviewDecision],
  )
  const handleTodoArchiveDiscard = useCallback(
    async (id: string) => {
      setError('')
      try {
        await deleteNote(id)
        if (todoArchiveCount <= 1) {
          setShowTodoArchive(false)
        }
        showTransientInfo('Handlung endgültig gelöscht.')
        await refreshAll()
      } catch {
        setError('Handlung konnte nicht gelöscht werden.')
      }
    },
    [refreshAll, showTransientInfo, todoArchiveCount],
  )

  const visibleTodoNotes = useMemo(() => {
    return todoNotes.filter((note) => {
      if (todoStarOnly && !note.starred) {
        return false
      }
      if (!matchesContextFilter(note, todoContextFilter)) {
        return false
      }
      return true
    })
  }, [todoNotes, todoStarOnly, todoContextFilter])

  const todoGroups = useMemo(() => {
    return groupNotesByContext(visibleTodoNotes, (a, b) => {
      if (a.starred !== b.starred) {
        return a.starred ? -1 : 1
      }
      return b.createdAt.localeCompare(a.createdAt)
    })
  }, [visibleTodoNotes])

  useEffect(() => {
    if (activeTab !== 'BRAINDUMP') {
      return
    }
    const frame = requestAnimationFrame(() => {
      scrollToBraindumpBottom('auto')
      shouldAutoScrollRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab, scrollToBraindumpBottom])

  useEffect(() => {
    if (activeTab !== 'BRAINDUMP') {
      return
    }
    if (!shouldAutoScrollRef.current) {
      return
    }
    const behavior = nextAutoScrollBehaviorRef.current
    nextAutoScrollBehaviorRef.current = 'auto'
    const frame = requestAnimationFrame(() => scrollToBraindumpBottom(behavior))
    return () => cancelAnimationFrame(frame)
  }, [activeTab, braindumpNotes, scrollToBraindumpBottom])

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
        if (activeTab === 'BRAINDUMP') {
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
              aria-label="Erfassen"
              title="Erfassen"
            >
              <span className="tab-button__inner">
                <svg className="tab-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 16.5V20h3.5L19 8.5 15.5 5 4 16.5Zm9.8-10.8 3.5 3.5M3.5 11.8H8m8-8v4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Erfassen</span>
              </span>
            </button>
            <button
              type="button"
              className={activeTab === 'REVIEW' ? 'tab-button tab-button--active' : 'tab-button'}
              onClick={() => setActiveTab('REVIEW')}
              aria-label="Sortieren"
              title="Sortieren"
            >
              <span className="tab-button__inner">
                <svg className="tab-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M3 6.5h18v10.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Zm0 7h5.2l1.7 2h4.2l1.7-2H21"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Sortieren</span>
              </span>
            </button>
            <button
              type="button"
              className={activeTab === 'THINKING' ? 'tab-button tab-button--active' : 'tab-button'}
              onClick={() => setActiveTab('THINKING')}
              aria-label="Reflektieren"
              title="Reflektieren"
            >
              <span className="tab-button__inner">
                <svg className="tab-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 4a8 8 0 1 0 8 8 8 8 0 0 0-8-8Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="m14.8 9.2-2 5.6-5.6 2 2-5.6 5.6-2Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Reflektieren</span>
              </span>
            </button>
            <button
              type="button"
              className={activeTab === 'TODO' ? 'tab-button tab-button--active' : 'tab-button'}
              onClick={() => setActiveTab('TODO')}
              aria-label="Handeln"
              title="Handeln"
            >
              <span className="tab-button__inner">
                <svg className="tab-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9 7h10M9 12h10M9 17h10M4 7l1.2 1.2L7 6M4 12l1.2 1.2L7 11M4 17l1.2 1.2L7 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Handeln</span>
              </span>
            </button>
            </div>

          <div className="header-actions">
            {syncStatus === 'offline' ? <span className="sync-pill">Offline</span> : null}
            {syncStatus === 'error' ? <span className="sync-pill sync-pill--error">Sync Fehler</span> : null}
            <button
              type="button"
              className="icon-button"
              onClick={() => setActiveTab('DATA')}
              aria-label="Daten öffnen"
              title="Daten öffnen"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 5.5h.01M12 12h.01M12 18.5h.01"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      }
    >
      <section className="app-content">
            {activeTab === 'DATA' ? (
              <DataScreen
                onExport={() => void handleExport()}
                showImportPanel={showImportPanel}
                onToggleImportPanel={() => setShowImportPanel((prev) => !prev)}
                onImportFileChange={setImportFile}
                importMode={importMode}
                onImportModeChange={setImportMode}
                onImport={() => void handleImport()}
                onToggleSyncEnabled={() => void handleToggleSyncEnabled()}
                onCreateSyncRoom={() => void handleCreateSyncRoom()}
                onWipeClient={() => void handleWipeClient()}
                syncEnabled={syncEnabled}
                onToggleDebugInfo={() => setShowDebugInfo((prev) => !prev)}
                showDebugInfo={showDebugInfo}
                onSyncNow={() => void handleSyncNow()}
                onCopySyncProtocol={() => void handleCopySyncProtocol()}
                syncNowBusy={syncNowBusy}
                lastBackupAtLabel={toBackupTimeLabel(lastBackupAt)}
                backupOverdue={backupOverdue}
                importReport={importReport}
                info={info}
                offlineReady={offlineReady}
                syncStatus={syncStatus}
                syncError={syncError}
                supabaseConfigStatus={supabaseConfigStatus}
                devSyncInfo={devSyncInfo}
                syncDiagnostics={syncDiagnostics}
                formatSyncTimeLabel={toSyncTimeLabel}
                syncPairCode={syncPairCode}
                scannerHint={scannerHint}
                syncPairCodeDraft={syncPairCodeDraft}
                onShowPairQr={handleShowPairQr}
                onOpenScanner={handleOpenScanner}
                onCopyPairCode={() => void handleCopyPairCode()}
                onPairCodeDraftChange={setSyncPairCodeDraft}
                onPasteFromClipboard={() => void handlePasteFromClipboard()}
                onImportPairCode={() => void handleImportPairCode()}
                showPairQr={showPairQr}
                onClosePairQr={() => setShowPairQr(false)}
                qrCanvasRef={qrCanvasRef}
                showScanner={showScanner}
                onCancelScanner={handleScannerCancel}
                scannerVideoRef={scannerVideoRef}
              />
            ) : null}

            <div className="tab-content">
          {activeTab === 'BRAINDUMP' ? (
            <BraindumpPage
              captureFeedback={braindumpCaptureFeedback}
              endRef={braindumpEndRef}
              onSubmitEntries={handleBraindumpSubmitEntries}
            />
          ) : null}

          {activeTab === 'REVIEW' ? (
            <>
              <FlowHero
                title="Weiter denken, umsetzen oder verwerfen"
                subtitle=""
              />
              {!staleReviewMode && staleTodos.length > 0 ? (
                <section className="stale-review-banner">
                  <span>Du hast {staleTodos.length} alte Handlungen (&gt;14 Tage). Kurz prüfen?</span>
                  <button type="button" className="review-btn review-btn--todo" onClick={startStaleReview}>
                    Prüfen
                  </button>
                </section>
              ) : null}

              {staleReviewMode ? (
                currentStaleNote ? (
                  <article className="review-focus-card" aria-label="Alte Handlung im Fokus">
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
              ) : (
                orderedInbox.length === 0 ? (
                  <section className="review-empty-cta" aria-label="Review leer">
                    <p className="empty-text">Deine Inbox ist leer.</p>
                    <p className="hint">Du kannst direkt mit bestehenden Gedanken oder Handlungen weiterarbeiten.</p>
                    <div className="review-empty-cta-actions">
                      <button type="button" className="review-btn review-btn--process" onClick={() => setActiveTab('THINKING')}>
                        Zu Gedanken
                      </button>
                      <button type="button" className="review-btn review-btn--todo" onClick={() => setActiveTab('TODO')}>
                        Zu Handlungen
                      </button>
                    </div>
                  </section>
                ) : (
                  <>
                    {overdueReviewCount > 0 ? (
                      <p className="review-intro">{`${overdueReviewCount} überfällige Einträge zuerst klären.`}</p>
                    ) : null}
                    <ul className="notes-list" aria-label="Review Liste">
                      {orderedInbox.map((note) => (
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
                            <label className="context-select-wrap">
                              <span className="sr-only">Bereich setzen</span>
                              <select
                                className="context-select"
                                value={note.context ?? ''}
                                onChange={(event) => {
                                  const nextValue = event.target.value
                                  void handleReviewContextChange(note.id, nextValue ? (nextValue as ContextTag) : undefined)
                                }}
                                aria-label="Bereich"
                                title="Bereich"
                              >
                                <option value="">Kein Bereich</option>
                                {CONTEXT_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="review-btn review-btn--todo review-btn--icon"
                              onClick={() =>
                                void handleReviewDecision(note.id, 'TODO', { enableUndo: true, sourceNote: note })
                              }
                              aria-label="Als Handlung markieren"
                              title="Als Handlung markieren"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                  d="M9 7h10M9 12h10M9 17h10M4 7l1.2 1.2L7 6M4 12l1.2 1.2L7 11M4 17l1.2 1.2L7 16"
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
                                  d="M12 4a8 8 0 1 0 8 8 8 8 0 0 0-8-8Z"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                />
                                <path
                                  d="m14.8 9.2-2 5.6-5.6 2 2-5.6 5.6-2Z"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinejoin="round"
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
                  </>
                )
              )}

              {lastAction ? (
                <div className="undo-snackbar" role="status" aria-live="polite">
                  <span>Gespeichert.</span>
                  <button type="button" onClick={() => void handleUndoLastReviewAction()} disabled={undoBusy}>
                    Rückgängig
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {activeTab === 'THINKING' ? (
            <>
            <FlowHero
              title="Gedanken vertiefen"
              subtitle=""
            />
            <div className="todo-filter-row">
              <label className="context-select-wrap">
                <span className="sr-only">Bereich filtern</span>
                <select
                  className="context-select context-select--filter"
                  value={thinkingContextFilter}
                  onChange={(event) => setThinkingContextFilter(event.target.value as ContextFilter)}
                  aria-label="Bereich filtern"
                  title="Bereich filtern"
                >
                  <option value="">Alle Bereiche</option>
                  <option value="__none">Ohne Bereich</option>
                  {CONTEXT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {processCount === 0 ? <p className="empty-text">Keine offenen Gedanken.</p> : null}
            {processCount > 0 && visibleProcessNotes.length === 0 ? (
              <p className="empty-text">
                {thinkingContextFilter === '__none'
                  ? 'Keine Gedanken ohne Bereich.'
                  : 'Keine Gedanken mit diesem Bereich.'}
              </p>
            ) : null}
            {thinkingGroups.map((group) => (
              <section key={group.contextKey} className="note-group">
                <div className="day-divider">{group.label}</div>
                <ul className="notes-list" aria-label={`Denken ${group.label}`}>
                  {group.notes.map((note) => (
                    <ThinkingNoteRow
                      key={note.id}
                      note={note}
                      onArchive={handleThinkingArchive}
                      onTodo={handleThinkingToTodo}
                      onBack={handleThinkingBackToReview}
                    />
                  ))}
                </ul>
              </section>
            ))}
            <div className="archive-toggle-row">
              <button
                type="button"
                className={showArchive ? 'archive-toggle archive-toggle--archive-action archive-toggle--active' : 'archive-toggle archive-toggle--archive-action'}
                onClick={() => setShowArchive((prev) => !prev)}
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
                <span>{showArchive ? `Archiv ausblenden (${thinkingArchiveCount})` : `Archiv anzeigen (${thinkingArchiveCount})`}</span>
              </button>
            </div>
            {showArchive ? (
              <>
                <h3 className="archive-title">Archiv</h3>
                {visibleThinkingArchivedNotes.length === 0 ? <p className="empty-text">Archiv ist leer.</p> : null}
                {archivedThinkingGroups.map((group) => (
                  <section key={group.contextKey} className="note-group">
                    <div className="day-divider">{group.label}</div>
                    <ul className="notes-list" aria-label={`Archiv ${group.label}`}>
                      {group.notes.map((note) => (
                        <ArchivedThinkingNoteRow
                          key={note.id}
                          note={note}
                          onBackToThinking={handleArchivedBackToThinking}
                          onDiscard={handleThinkingArchiveDiscard}
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
            <FlowHero
              title="Nächste Schritte"
              subtitle=""
            />
            <div className="todo-filter-row">
              <button
                type="button"
                className={todoStarOnly ? 'review-btn review-btn--star review-btn--star-active review-btn--icon' : 'review-btn review-btn--star review-btn--icon'}
                onClick={() => setTodoStarOnly((prev) => !prev)}
                aria-label={todoStarOnly ? 'Alle Handlungen anzeigen' : 'Nur wichtige Handlungen anzeigen'}
                title={todoStarOnly ? 'Filter: Alle Handlungen' : 'Filter: Nur wichtige Handlungen'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="m12 3.8 2.6 5.2 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z"
                    fill={todoStarOnly ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <label className="context-select-wrap">
                <span className="sr-only">Bereich filtern</span>
                <select
                  className="context-select context-select--filter"
                  value={todoContextFilter}
                  onChange={(event) => setTodoContextFilter(event.target.value as ContextFilter)}
                  aria-label="Bereich filtern"
                  title="Bereich filtern"
                >
                  <option value="">Alle Bereiche</option>
                  <option value="__none">Ohne Bereich</option>
                  {CONTEXT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
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
            {todoNotes.length === 0 ? <p className="empty-text">Keine offenen Handlungen.</p> : null}
            {todoNotes.length > 0 && visibleTodoNotes.length === 0 ? (
              <p className="empty-text">
                {todoStarOnly && todoContextFilter
                  ? 'Keine Handlungen mit diesem Bereich und Stern.'
                  : todoStarOnly
                    ? 'Keine Handlungen mit Stern.'
                    : todoContextFilter === '__none'
                      ? 'Keine Handlungen ohne Bereich.'
                      : todoContextFilter
                      ? 'Keine Handlungen mit diesem Bereich.'
                      : 'Keine passenden Handlungen.'}
              </p>
            ) : null}
            {todoGroups.map((group) => (
              <section key={group.contextKey} className="note-group">
                <div className="day-divider">{group.label}</div>
                <ul className="notes-list" aria-label={`Handlungen ${group.label}`}>
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
            <div className="archive-toggle-row">
              <button
                type="button"
                className={showTodoArchive ? 'archive-toggle archive-toggle--archive-action archive-toggle--active' : 'archive-toggle archive-toggle--archive-action'}
                onClick={() => setShowTodoArchive((prev) => !prev)}
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
                <span>{showTodoArchive ? `Archiv ausblenden (${todoArchiveCount})` : `Archiv anzeigen (${todoArchiveCount})`}</span>
              </button>
            </div>
            {showTodoArchive ? (
              <>
                <h3 className="archive-title">Archiv</h3>
                {visibleTodoArchivedNotes.length === 0 ? <p className="empty-text">Archiv ist leer.</p> : null}
                {archivedTodoGroups.map((group) => (
                  <section key={group.contextKey} className="note-group">
                    <div className="day-divider">{group.label}</div>
                    <ul className="notes-list" aria-label={`Handlungen Archiv ${group.label}`}>
                      {group.notes.map((note) => (
                        <ArchivedTodoNoteRow
                          key={note.id}
                          note={note}
                          onBackToTodo={handleArchivedBackToTodo}
                          onDiscard={handleTodoArchiveDiscard}
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
