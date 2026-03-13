import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import type { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser'
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
  listArchiveHardDeleteCandidates,
  listNotesByStatus,
  listRecentActiveNotes,
  listTodoReturnToInboxCandidates,
  listTodoNotes,
  clearUnknownContexts,
  replaceContextAcrossNotes,
  hardDeleteNotes,
  restoreNote,
  setSyncEnabled,
  updateSyncState,
  updateNoteArchiveBucket,
  updateNoteContext,
  updateNoteText,
  updateNoteStarred,
  updateNoteStatus,
} from './lib/dbNotes'
import { getLocalDayISO } from './lib/date'
import {
  readStorageItem,
  readTrimmedStorageItem,
  removeStorageItem,
  writeStorageItem,
} from './lib/storage'
import { normalizeContextTag } from './lib/types'
import type { ContextTag, Note, NoteStatus } from './lib/types'
import { AppShell } from './app/AppShell'
import { FlowHero } from './app/FlowHero'
import { FooterProvider } from './app/FooterContext'
import { BackupScreen } from './app/data/BackupScreen'
import { DataScreen } from './app/data/DataScreen'
import type { ArchiveWarningEntry, MaintenanceLogEntry } from './app/data/RetentionPanel'
import { AboutScreen } from './components/AboutScreen'
import { InboxEmptyState } from './components/InboxEmptyState'
import { LandingScreen } from './components/LandingScreen'
import type { DevSyncInfo } from './app/data/SyncPanel'
import type { ImportMode, ImportReport } from './lib/backup'
import { getSupabaseRuntimeConfig } from './lib/runtimeConfig'
import type { SyncDiagnostics, SyncUiStatus } from './lib/syncEngine'

type TabKey = 'BRAINDUMP' | 'REVIEW' | 'THINKING' | 'TODO' | 'SETTINGS' | 'DATA' | 'BACKUP' | 'ABOUT' | 'CONTEXTS'
const SOFT_CHAR_LIMIT = 200
const REVIEW_LIMIT = 50
const FRESH_HOURS = 12
const TODO_STALE_DAYS = 7
const TODO_RETURN_TO_REVIEW_DAYS = 14
const TODO_RETURN_TO_REVIEW_BATCH_LIMIT = 200
const OVERDUE_DAYS = 3
const AUTOSCROLL_NEAR_BOTTOM_PX = 80
const BRAINDUMP_FETCH_LIMIT = 300
const ARCHIVE_HARD_DELETE_DAYS = 30
const ARCHIVE_WARNING_DAYS = 7
const ARCHIVE_HARD_DELETE_BATCH_LIMIT = 200
const ARCHIVE_CLEAR_FETCH_LIMIT = 5000
const MAINTENANCE_LOG_LIMIT = 12
const ARCHIVE_HARD_DELETE_LAST_RUN_KEY = 'leiser:archive-hard-delete-last-run-day'
const MAINTENANCE_LOG_STORAGE_KEY = 'leiser:maintenance-log-v1'
const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR
const SYNC_ID_STORAGE_KEY = 'leiser-sync-id'
const SYNC_TOKEN_STORAGE_KEY = 'leiser-sync-token'
const SYNC_KEY_STORAGE_KEY = 'leiser-sync-key'
const SHOW_DEBUG_INFO_STORAGE_KEY = 'leiser:show-debug-info'
const LAST_BACKUP_AT_STORAGE_KEY = 'leiser:last-backup-at'
const RELOAD_AFTER_INACTIVITY_MS = 20 * 60 * 1000
const FEEDBACK_VISIBILITY_MS = 3000
const TRANSIENT_INFO_FADE_OUT_MS = 260
const SW_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000
const BACKUP_OVERDUE_DAYS = 7
const ONBOARDING_COMPLETED_STORAGE_KEY = 'leiser:onboarding:completed:v1'
const CONTEXT_OPTIONS_STORAGE_KEY = 'leiser:context-options-v1'
const REDUCE_MAIN_TAB_HELPERS_STORAGE_KEY = 'leiser:reduce-main-tab-helpers:v1'
const MAX_CONTEXT_OPTIONS = 8

let backupModulePromise: Promise<typeof import('./lib/backup')> | null = null
let qrCodeModulePromise: Promise<typeof import('qrcode')> | null = null
let syncEngineModulePromise: Promise<typeof import('./lib/syncEngine')> | null = null
let zxingBrowserModulePromise: Promise<typeof import('@zxing/browser')> | null = null

function loadBackupModule() {
  if (!backupModulePromise) {
    backupModulePromise = import('./lib/backup')
  }
  return backupModulePromise
}

function loadQrCodeModule() {
  if (!qrCodeModulePromise) {
    qrCodeModulePromise = import('qrcode')
  }
  return qrCodeModulePromise
}

function loadSyncEngineModule() {
  if (!syncEngineModulePromise) {
    syncEngineModulePromise = import('./lib/syncEngine')
  }
  return syncEngineModulePromise
}

function loadZxingBrowserModule() {
  if (!zxingBrowserModulePromise) {
    zxingBrowserModulePromise = import('@zxing/browser')
  }
  return zxingBrowserModulePromise
}

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
  restoresDelete?: boolean
  scope?: 'THINKING' | 'TODO'
}
type CaptureFeedback = {
  id: number
  text: string
}

function readStoredMaintenanceLog(): MaintenanceLogEntry[] {
  const raw = readStorageItem(MAINTENANCE_LOG_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((entry): entry is MaintenanceLogEntry => {
        if (!entry || typeof entry !== 'object') {
          return false
        }
        const candidate = entry as Record<string, unknown>
        return typeof candidate.id === 'string' && typeof candidate.at === 'string' && typeof candidate.message === 'string'
      })
      .slice(0, MAINTENANCE_LOG_LIMIT)
  } catch {
    return []
  }
}

type ContextFilter = '' | '__none' | ContextTag
type ContextGroup = {
  contextKey: '__none' | ContextTag
  label: string
  notes: Note[]
}
type ContextOption = {
  value: ContextTag
  label: string
}

type ParsedBraindumpEntry = {
  text: string
  context?: ContextTag
}

type ContextHashtagMatch = {
  start: number
  end: number
  context: ContextTag
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

function daysUntilArchiveHardDelete(note: Note, nowMs = Date.now()) {
  const updatedMs = Date.parse(note.updatedAt)
  if (!Number.isFinite(updatedMs)) {
    return null
  }
  const ageDays = Math.floor(Math.max(0, nowMs - updatedMs) / MS_PER_DAY)
  return Math.max(0, ARCHIVE_HARD_DELETE_DAYS - ageDays)
}

function trimPreviewText(text: string, maxLength = 84) {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact || 'Ohne Text'
  }
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`
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

const DEFAULT_CONTEXT_OPTIONS: ContextOption[] = [
  { value: 'arbeit', label: 'Arbeit' },
  { value: 'familie', label: 'Familie' },
  { value: 'finanzen', label: 'Finanzen' },
  { value: 'freunde', label: 'Freunde' },
  { value: 'gesundheit', label: 'Gesundheit' },
  { value: 'haushalt', label: 'Haushalt' },
  { value: 'privat', label: 'Privat' },
  { value: 'projekt', label: 'Projekt' },
]

function fallbackContextLabel(context: ContextTag) {
  return context
}

function normalizeContextLabel(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) {
    return undefined
  }
  return compact.slice(0, 28)
}

function sanitizeContextOptions(raw: unknown): ContextOption[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_CONTEXT_OPTIONS]
  }
  const deduped = new Map<ContextTag, string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const candidate = item as Partial<ContextOption>
    const name = normalizeContextLabel(candidate.label ?? candidate.value)
    const value = normalizeContextTag(name)
    if (!value || deduped.has(value)) {
      continue
    }
    const label = normalizeContextLabel(candidate.label) ?? capitalizeFirstCharacter(value)
    deduped.set(value, capitalizeFirstCharacter(label))
  }
  if (deduped.size === 0) {
    return [...DEFAULT_CONTEXT_OPTIONS]
  }
  return Array.from(deduped.entries()).map(([value, label]) => ({ value, label }))
}

function readStoredContextOptions() {
  const raw = readStorageItem(CONTEXT_OPTIONS_STORAGE_KEY)
  if (!raw) {
    return [...DEFAULT_CONTEXT_OPTIONS]
  }
  try {
    return sanitizeContextOptions(JSON.parse(raw))
  } catch {
    return [...DEFAULT_CONTEXT_OPTIONS]
  }
}

function persistContextOptions(options: ContextOption[]) {
  writeStorageItem(CONTEXT_OPTIONS_STORAGE_KEY, JSON.stringify(options))
}

function contextLabel(context: ContextTag, options: ContextOption[]) {
  const contextKey = normalizeContextTag(context)
  if (!contextKey) {
    return fallbackContextLabel(context)
  }
  const match = options.find((option) => normalizeContextTag(option.value) === contextKey)
  return match?.label ?? fallbackContextLabel(context)
}

function capitalizeFirstCharacter(value: string) {
  if (!value) {
    return value
  }
  const characters = Array.from(value)
  const [first, ...rest] = characters
  return `${first.toLocaleUpperCase('de-DE')}${rest.join('')}`
}

function contextGroupLabel(context: '__none' | ContextTag, options: ContextOption[]) {
  if (context === '__none') {
    return 'Ohne Kontext'
  }
  return capitalizeFirstCharacter(contextLabel(context, options))
}

function contextFilterPhrase(filter: ContextFilter, options: ContextOption[]) {
  if (filter === '__none') {
    return 'ohne Kontext'
  }
  if (filter) {
    return contextLabel(filter, options)
  }
  return 'alle Kontexte'
}

function findValidContextHashtags(entry: string, options: ContextOption[]): ContextHashtagMatch[] {
  const optionByLowerValue = new Map(options.map((option) => [option.value.toLocaleLowerCase('de-DE'), option.value]))
  const hashtagPattern = /(^|\s)([#.])([^\s#.]+)/g
  const matches: ContextHashtagMatch[] = []
  let current: RegExpExecArray | null = hashtagPattern.exec(entry)
  while (current) {
    const [, prefix, marker, rawTag] = current
    const normalizedTag = normalizeContextTag(rawTag)
    if (normalizedTag) {
      const context = optionByLowerValue.get(normalizedTag.toLocaleLowerCase('de-DE'))
      if (context) {
        const hashtagStart = current.index + prefix.length
        const hashtagEnd = hashtagStart + marker.length + rawTag.length
        matches.push({ start: hashtagStart, end: hashtagEnd, context })
      }
    }
    current = hashtagPattern.exec(entry)
  }
  return matches
}

function parseBraindumpEntryForContext(entry: string, options: ContextOption[]): ParsedBraindumpEntry {
  const trimmed = entry.trim()
  if (!trimmed) {
    return { text: '' }
  }

  const match = findValidContextHashtags(trimmed, options)[0]

  if (!match) {
    return { text: trimmed }
  }

  const withoutHashtag = `${trimmed.slice(0, match.start)} ${trimmed.slice(match.end)}`
    .replace(/\s+/g, ' ')
    .trim()
  return {
    text: withoutHashtag,
    context: match.context,
  }
}

function readHasVisitedFlag() {
  return readStorageItem(ONBOARDING_COMPLETED_STORAGE_KEY) === '1'
}

function persistHasVisitedFlag() {
  writeStorageItem(ONBOARDING_COMPLETED_STORAGE_KEY, '1')
}

function readReduceMainTabHelpersFlag() {
  return readStorageItem(REDUCE_MAIN_TAB_HELPERS_STORAGE_KEY) === '1'
}

function matchesContextFilter(note: Note, filter: ContextFilter) {
  if (!filter) {
    return true
  }
  if (filter === '__none') {
    return !note.context
  }
  return normalizeContextTag(note.context) === normalizeContextTag(filter)
}

function matchesTodoSearch(note: Note, searchQuery: string) {
  if (!searchQuery) {
    return true
  }
  const haystack = `${note.text} ${note.context ?? ''}`.toLocaleLowerCase('de-DE')
  return searchQuery.split(/\s+/).every((token) => haystack.includes(token))
}

function isThinkingArchiveNote(note: Note) {
  return note.archiveBucket === 'THINKING' || (note.archiveBucket == null && note.type !== 'TASK')
}

function isTodoArchiveNote(note: Note) {
  return note.archiveBucket === 'TODO' || (note.archiveBucket == null && note.type === 'TASK')
}

function groupNotesByContext(
  notes: Note[],
  noteSort: (a: Note, b: Note) => number,
  options: ContextOption[],
): ContextGroup[] {
  const grouped = new Map<'__none' | ContextTag, Note[]>()
  for (const note of notes) {
    const normalizedContext = normalizeContextTag(note.context)
    const key: '__none' | ContextTag = normalizedContext ?? '__none'
    const existing = grouped.get(key)
    if (existing) {
      existing.push(note)
    } else {
      grouped.set(key, [note])
    }
  }

  const groups: ContextGroup[] = Array.from(grouped.entries()).map(([contextKey, groupedNotes]) => ({
    contextKey,
    label: contextGroupLabel(contextKey, options),
    notes: [...groupedNotes].sort(noteSort),
  }))

  groups.sort((a, b) => a.label.localeCompare(b.label, 'de-DE'))
  return groups
}

function ExpandableNoteText({ text }: { text: string }) {
  const NOTE_TEXT_LIMIT = 200
  const compactText = text.length > NOTE_TEXT_LIMIT ? `${text.slice(0, NOTE_TEXT_LIMIT).trimEnd()}…` : text
  return (
    <span className="note-text-wrap note-text-wrap--plain">
      <span className="note-text note-text--expanded">{compactText}</span>
    </span>
  )
}

function todoActionLabel(status: NoteStatus) {
  if (status === 'ARCHIVE') return 'Als erledigt markiert.'
  if (status === 'INBOX') return 'Zurück in Inbox verschoben.'
  if (status === 'DISCARD') return 'Im Archiv gelöscht.'
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

function isTodoStale(note: Note): boolean {
  const basisISO = note.updatedAt || note.createdAt
  const basisMs = Date.parse(basisISO)
  if (!Number.isFinite(basisMs)) {
    return false
  }
  const ageMs = Date.now() - basisMs
  return ageMs >= TODO_STALE_DAYS * MS_PER_DAY
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
  showInboxEmptyState,
  onSubmitEntries,
  contextOptions,
}: {
  captureFeedback: CaptureFeedback | null
  showInboxEmptyState: boolean
  onSubmitEntries: (entries: string[]) => Promise<boolean>
  contextOptions: ContextOption[]
}) {
  return (
    <>
      <section className="braindump-hero" aria-label="Braindump Einführung">
        <h2>Lass es raus</h2>
      </section>
      {showInboxEmptyState ? <InboxEmptyState /> : null}
      <div className="braindump-capture-feedback-slot">
        {captureFeedback ? (
          <p key={captureFeedback.id} className="braindump-capture-feedback" role="status" aria-live="polite">
            {captureFeedback.text}
          </p>
        ) : (
          <p className="braindump-capture-feedback braindump-capture-feedback--placeholder" aria-hidden="true">
            &nbsp;
          </p>
        )}
      </div>
      <BraindumpComposer onSubmitEntries={onSubmitEntries} contextOptions={contextOptions} />
    </>
  )
})

type NoteMenuAction = {
  label: string
  onSelect: () => void
  variant?: 'todo' | 'process' | 'done' | 'archive' | 'back' | 'discard' | 'star' | 'edit'
}

function NoteActionMenu({
  ariaLabel,
  actions,
}: {
  ariaLabel: string
  actions: NoteMenuAction[]
}) {
  return (
    <details className="note-action-menu">
      <summary
        className="review-btn review-btn--icon review-btn--more"
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 12a1.6 1.6 0 1 0 0 .01M12 12a1.6 1.6 0 1 0 0 .01M19 12a1.6 1.6 0 1 0 0 .01"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </summary>
      <div className="note-action-menu__list" role="menu" aria-label={ariaLabel}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`note-action-menu__item${action.variant ? ` note-action-menu__item--${action.variant}` : ''}`}
            role="menuitem"
            onClick={(event) => {
              action.onSelect()
              const detailsElement = event.currentTarget.closest('details')
              if (detailsElement instanceof HTMLDetailsElement) {
                detailsElement.open = false
              }
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </details>
  )
}

function ReviewNoteRow({
  note,
  contextOptions,
  onContextChange,
  onToTodo,
  onToMemos,
  onDiscard,
  onSaveEdit,
}: {
  note: Note
  contextOptions: ContextOption[]
  onContextChange: (id: string, context: ContextTag | undefined) => void
  onToTodo: (id: string) => void
  onToMemos: (id: string) => void
  onDiscard: (id: string) => void
  onSaveEdit: (id: string, text: string, context: ContextTag | undefined) => Promise<boolean>
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [draftText, setDraftText] = useState(note.text)
  const [draftContext, setDraftContext] = useState<ContextTag | ''>(note.context ?? '')
  const [editError, setEditError] = useState('')

  const handleCancelEdit = () => {
    if (isSaving) {
      return
    }
    setIsEditing(false)
    setEditError('')
    setDraftText(note.text)
    setDraftContext(note.context ?? '')
  }

  const handleSaveEdit = useCallback(async () => {
    if (isSaving) {
      return
    }
    const nextText = draftText.trim()
    if (!nextText) {
      setEditError('Text darf nicht leer sein.')
      return
    }
    setEditError('')
    setIsSaving(true)
    const saved = await onSaveEdit(note.id, nextText, draftContext || undefined)
    setIsSaving(false)
    if (saved) {
      setIsEditing(false)
    } else {
      setEditError('Änderungen konnten nicht gespeichert werden.')
    }
  }, [draftContext, draftText, isSaving, note.id, onSaveEdit])

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEdit()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSaveEdit()
    }
  }

  const ageCategory = getReviewAgeCategory(note)
  const ageText = reviewAgeLabel(ageCategory)

  return (
    <li className={isEditing ? 'note-item note-item--todo note-item--review-row note-item--editing' : 'note-item note-item--todo note-item--review-row'}>
      {isEditing ? (
        <div className="note-edit-panel">
          <textarea
            rows={3}
            className="note-edit-textarea"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            aria-label="Inbox-Eintrag bearbeiten"
          />
          <label className="context-select-wrap">
            <span className="sr-only">Kontext im Inbox-Eintrag bearbeiten</span>
            <select
              className="context-select"
              value={draftContext}
              onChange={(event) => setDraftContext((event.target.value ? normalizeContextTag(event.target.value) : '') ?? '')}
              aria-label="Kontext"
              title="Kontext"
            >
              <option value="">Kein Kontext</option>
              {contextOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {editError ? <p className="error-text">{editError}</p> : null}
          <p className="hint edit-shortcut-hint">Enter: speichern, Shift+Enter: Zeilenumbruch, Esc: abbrechen</p>
        </div>
      ) : (
        <span className="note-content">
          <ExpandableNoteText text={note.text} />
          {ageText ? (
            <span className={`age-badge age-badge--${ageCategory.toLowerCase()}`}>
              {ageText}
            </span>
          ) : null}
        </span>
      )}
      <div className="todo-actions">
        {isEditing ? (
          <>
            <button type="button" className="review-btn review-btn--todo" onClick={() => void handleSaveEdit()} disabled={isSaving}>
              Speichern
            </button>
            <button type="button" className="review-btn review-btn--back" onClick={handleCancelEdit} disabled={isSaving}>
              Abbrechen
            </button>
          </>
        ) : (
          <>
            <label className="context-select-wrap">
              <span className="sr-only">Kontext setzen</span>
              <select
                className="context-select"
                value={note.context ?? ''}
                onChange={(event) => {
                  const nextValue = event.target.value
                  onContextChange(note.id, nextValue ? normalizeContextTag(nextValue) : undefined)
                }}
                aria-label="Kontext"
                title="Kontext"
              >
                <option value="">Kein Kontext</option>
                {contextOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="review-action-row" role="group" aria-label="Aktionen">
                <NoteActionMenu
                  ariaLabel="Weitere Aktionen für Inbox-Eintrag"
                  actions={[
                    { label: 'In Machen verschieben', onSelect: () => onToTodo(note.id), variant: 'todo' },
                    { label: 'In Memos verschieben', onSelect: () => onToMemos(note.id), variant: 'process' },
                    {
                      label: 'Bearbeiten',
                      onSelect: () => {
                        setDraftText(note.text)
                        setDraftContext(note.context ?? '')
                        setEditError('')
                        setIsEditing(true)
                      },
                      variant: 'edit',
                    },
                    { label: 'Verwerfen', onSelect: () => onDiscard(note.id), variant: 'discard' },
                  ]}
                />
            </div>
          </>
        )}
      </div>
    </li>
  )
}

function TodoNoteRow({
  note,
  contextOptions,
  onSaveEdit,
  onToggleStar,
  onDone,
  onThinking,
}: {
  note: Note
  contextOptions: ContextOption[]
  onSaveEdit: (id: string, text: string, context: ContextTag | undefined) => Promise<boolean>
  onToggleStar: (id: string, starred: boolean) => void
  onDone: (id: string) => void
  onThinking: (id: string) => void
}) {
  const stale = isTodoStale(note)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [draftText, setDraftText] = useState(note.text)
  const [draftContext, setDraftContext] = useState<ContextTag | ''>(note.context ?? '')
  const [editError, setEditError] = useState('')

  const handleCancelEdit = () => {
    if (isSaving) {
      return
    }
    setIsEditing(false)
    setEditError('')
    setDraftText(note.text)
    setDraftContext(note.context ?? '')
  }

  const handleSaveEdit = useCallback(async () => {
    if (isSaving) {
      return
    }
    const nextText = draftText.trim()
    if (!nextText) {
      setEditError('Text darf nicht leer sein.')
      return
    }
    setEditError('')
    setIsSaving(true)
    const saved = await onSaveEdit(note.id, nextText, draftContext || undefined)
    setIsSaving(false)
    if (saved) {
      setIsEditing(false)
    } else {
      setEditError('Änderungen konnten nicht gespeichert werden.')
    }
  }, [draftContext, draftText, isSaving, note.id, onSaveEdit])

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEdit()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSaveEdit()
    }
  }

  const itemClassName = [
    'note-item',
    'note-item--todo',
    stale ? 'note-item--todo-stale' : '',
    isEditing ? 'note-item--editing' : '',
  ].filter(Boolean).join(' ')

  return (
    <li key={note.id} className={itemClassName}>
      {isEditing ? (
        <div className="note-edit-panel">
          <textarea
            rows={3}
            className="note-edit-textarea"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            aria-label="Task bearbeiten"
          />
          <label className="context-select-wrap">
            <span className="sr-only">Kontext im Task bearbeiten</span>
            <select
              className="context-select"
              value={draftContext}
              onChange={(event) => setDraftContext((event.target.value ? normalizeContextTag(event.target.value) : '') ?? '')}
              aria-label="Kontext"
              title="Kontext"
            >
              <option value="">Kein Kontext</option>
              {contextOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {editError ? <p className="error-text">{editError}</p> : null}
          <p className="hint edit-shortcut-hint">Enter: speichern, Shift+Enter: Zeilenumbruch, Esc: abbrechen</p>
        </div>
      ) : (
        <span className="note-content">
          <ExpandableNoteText text={note.text} />
        </span>
      )}
      <div className="todo-actions">
        {isEditing ? (
          <>
            <button type="button" className="review-btn review-btn--todo" onClick={() => void handleSaveEdit()} disabled={isSaving}>
              Speichern
            </button>
            <button type="button" className="review-btn review-btn--back" onClick={handleCancelEdit} disabled={isSaving}>
              Abbrechen
            </button>
          </>
        ) : (
          <>
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
        <NoteActionMenu
          ariaLabel="Weitere Aktionen für Handlung"
          actions={[
            {
              label: 'Bearbeiten',
              onSelect: () => {
                setDraftText(note.text)
                setDraftContext(note.context ?? '')
                setEditError('')
                setIsEditing(true)
              },
              variant: 'edit',
            },
            { label: 'In Memos verschieben', onSelect: () => onThinking(note.id), variant: 'process' },
          ]}
        />
          </>
        )}
      </div>
    </li>
  )
}

function ThinkingNoteRow({
  note,
  contextOptions,
  onSaveEdit,
  onArchive,
  onTodo,
}: {
  note: Note
  contextOptions: ContextOption[]
  onSaveEdit: (id: string, text: string, context: ContextTag | undefined) => Promise<boolean>
  onArchive: (id: string) => void
  onTodo: (id: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [draftText, setDraftText] = useState(note.text)
  const [draftContext, setDraftContext] = useState<ContextTag | ''>(note.context ?? '')
  const [editError, setEditError] = useState('')

  const handleCancelEdit = () => {
    if (isSaving) {
      return
    }
    setIsEditing(false)
    setEditError('')
    setDraftText(note.text)
    setDraftContext(note.context ?? '')
  }

  const handleSaveEdit = useCallback(async () => {
    if (isSaving) {
      return
    }
    const nextText = draftText.trim()
    if (!nextText) {
      setEditError('Text darf nicht leer sein.')
      return
    }
    setEditError('')
    setIsSaving(true)
    const saved = await onSaveEdit(note.id, nextText, draftContext || undefined)
    setIsSaving(false)
    if (saved) {
      setIsEditing(false)
    } else {
      setEditError('Änderungen konnten nicht gespeichert werden.')
    }
  }, [draftContext, draftText, isSaving, note.id, onSaveEdit])

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEdit()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSaveEdit()
    }
  }

  return (
    <li className={isEditing ? 'note-item note-item--todo note-item--editing' : 'note-item note-item--todo'}>
      {isEditing ? (
        <div className="note-edit-panel">
          <textarea
            rows={3}
            className="note-edit-textarea"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            aria-label="Memo bearbeiten"
          />
          <label className="context-select-wrap">
            <span className="sr-only">Kontext im Memo bearbeiten</span>
            <select
              className="context-select"
              value={draftContext}
              onChange={(event) => setDraftContext((event.target.value ? normalizeContextTag(event.target.value) : '') ?? '')}
              aria-label="Kontext"
              title="Kontext"
            >
              <option value="">Kein Kontext</option>
              {contextOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {editError ? <p className="error-text">{editError}</p> : null}
          <p className="hint edit-shortcut-hint">Enter: speichern, Shift+Enter: Zeilenumbruch, Esc: abbrechen</p>
        </div>
      ) : (
        <span className="note-content">
          <ExpandableNoteText text={note.text} />
        </span>
      )}
      <div className="todo-actions">
        {isEditing ? (
          <>
            <button type="button" className="review-btn review-btn--todo" onClick={() => void handleSaveEdit()} disabled={isSaving}>
              Speichern
            </button>
            <button type="button" className="review-btn review-btn--back" onClick={handleCancelEdit} disabled={isSaving}>
              Abbrechen
            </button>
          </>
        ) : (
          <>
        <NoteActionMenu
          ariaLabel="Weitere Aktionen für Memos"
          actions={[
            { label: 'In Machen verschieben', onSelect: () => onTodo(note.id), variant: 'todo' },
            {
              label: 'Bearbeiten',
              onSelect: () => {
                setDraftText(note.text)
                setDraftContext(note.context ?? '')
                setEditError('')
                setIsEditing(true)
              },
              variant: 'edit',
            },
            { label: 'Archivieren', onSelect: () => onArchive(note.id), variant: 'archive' },
          ]}
        />
          </>
        )}
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
      </span>
      <div className="todo-actions">
        <button
          type="button"
          className="review-btn review-btn--back review-btn--icon"
          onClick={() => onBackToThinking(note.id)}
          aria-label="In Memos"
          title="In Memos"
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
              d="M4 7h16M9 7l1-2h4l1 2M8 7l1 12h6l1-12M10 11v6M14 11v6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
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
      </span>
      <div className="todo-actions">
        <button
          type="button"
          className="review-btn review-btn--back review-btn--icon"
          onClick={() => onBackToTodo(note.id)}
          aria-label="Zurück zu Handlungen"
          title="Zurück zu Handlungen"
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
              d="M4 7h16M9 7l1-2h4l1 2M8 7l1 12h6l1-12M10 11v6M14 11v6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
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
  contextOptions,
}: {
  onSubmitEntries: (entries: string[]) => Promise<boolean>
  contextOptions: ContextOption[]
}) {
  const [text, setText] = useState('')
  const [caretPosition, setCaretPosition] = useState(0)
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
    const saved = await onSubmitEntries(cleaned)
    if (!saved) {
      return
    }
    setText('')
    setFlashInput(true)
    window.setTimeout(() => setFlashInput(false), 120)
    if (!(typeof window !== 'undefined' && window.visualViewport)) {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [onSubmitEntries])

  const activeHashtagToken = useMemo(() => {
    const safeCaret = Math.max(0, Math.min(caretPosition, text.length))
    const beforeCaret = text.slice(0, safeCaret)
    const match = beforeCaret.match(/(^|\s)([#.])([^\s#.]*)$/)
    if (!match) {
      return null
    }
    const token = match[0]
    const leadingSpace = match[1] ?? ''
    const marker = match[2] ?? '#'
    const query = match[3] ?? ''
    const start = safeCaret - token.length + leadingSpace.length
    const end = safeCaret
    return { query, start, end, marker }
  }, [caretPosition, text])

  const validContextHashtags = useMemo(() => findValidContextHashtags(text, contextOptions), [text, contextOptions])
  const selectedContextHint = validContextHashtags[0]?.context

  const contextSuggestions = useMemo(() => {
    if (activeHashtagToken == null) {
      return []
    }
    const isEditingExistingValidTag = validContextHashtags.some(
      (match) => activeHashtagToken.start < match.end && activeHashtagToken.end > match.start,
    )
    if (validContextHashtags.length > 0 && !isEditingExistingValidTag) {
      return []
    }
    const normalizedQuery = activeHashtagToken.query.toLocaleLowerCase('de-DE')
    const startsWith = contextOptions.filter((option) =>
      option.value.toLocaleLowerCase('de-DE').startsWith(normalizedQuery),
    )
    const includes = normalizedQuery
      ? contextOptions.filter(
        (option) =>
          !option.value.toLocaleLowerCase('de-DE').startsWith(normalizedQuery)
          && option.value.toLocaleLowerCase('de-DE').includes(normalizedQuery),
      )
      : []
    return [...startsWith, ...includes]
  }, [activeHashtagToken, contextOptions, validContextHashtags])

  const applyContextSuggestion = useCallback((nextContext: ContextTag) => {
    const input = inputRef.current
    const currentText = input?.value ?? text
    const caret = input?.selectionStart ?? caretPosition
    const beforeCaret = currentText.slice(0, caret)
    const match = beforeCaret.match(/(^|\s)([#.])([^\s#.]*)$/)
    if (!match) {
      return
    }
    const fullMatch = match[0]
    const leadingSpace = match[1] ?? ''
    const marker = match[2] ?? '#'
    const replaceStart = caret - fullMatch.length + leadingSpace.length
    const replaceEnd = caret
    const nextText = `${currentText.slice(0, replaceStart)}${marker}${nextContext} ${currentText.slice(replaceEnd)}`
    const nextCaret = replaceStart + nextContext.length + 2
    latestTextRef.current = nextText
    setText(nextText)
    setCaretPosition(nextCaret)
    requestAnimationFrame(() => {
      input?.focus({ preventScroll: true })
      input?.setSelectionRange(nextCaret, nextCaret)
    })
  }, [caretPosition, text])

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
            setCaretPosition(event.target.selectionStart ?? event.target.value.length)
          }}
          onClick={(event) => setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onKeyUp={(event) => setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onKeyDown={handleTextKeyDown}
        />
        {activeHashtagToken !== null && contextSuggestions.length > 0 ? (
          <div className="capture-context-suggest" role="listbox" aria-label="Bestehende Kontexte">
            {contextSuggestions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="capture-context-suggest__item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyContextSuggestion(option.value)}
                aria-label={`Kontext ${option.label} einsetzen`}
              >
                {`${activeHashtagToken.marker}${option.label}`}
              </button>
            ))}
          </div>
        ) : null}
        <div className="capture-actions">
          <div className="capture-meta-row">
            <small className={text.length > SOFT_CHAR_LIMIT ? 'counter counter--warning' : 'counter'}>
              {text.length} / {SOFT_CHAR_LIMIT}
            </small>
            <small className="capture-hint capture-hint--stack">
              <span>Enter: speichern</span>
              <span>mit - als Präfix direkt in 'Machen' anlegen</span>
              <span>mit : als Präfix direkt in 'Memos' anlegen</span>
              <span>
                {selectedContextHint
                  ? `#${selectedContextHint}: als Kontext (Tag wird aus dem Text übernommen)`
                  : '#Kontext: als Kontext übernehmen'}
              </span>
            </small>
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
          <small className="soft-limit-hint">Vielleicht sind das mehrere Memos.</small>
        ) : null}
      </form>
    </div>
  )
}

function BraindumpPage({
  captureFeedback,
  endRef,
  showInboxEmptyState,
  onSubmitEntries,
  contextOptions,
}: {
  captureFeedback: CaptureFeedback | null
  endRef: RefObject<HTMLDivElement | null>
  showInboxEmptyState: boolean
  onSubmitEntries: (entries: string[]) => Promise<boolean>
  contextOptions: ContextOption[]
}) {
  return (
    <>
      <BraindumpList
        captureFeedback={captureFeedback}
        showInboxEmptyState={showInboxEmptyState}
        onSubmitEntries={onSubmitEntries}
        contextOptions={contextOptions}
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
  const [todoSearchQuery, setTodoSearchQuery] = useState('')
  const [archivedNotes, setArchivedNotes] = useState<Note[]>([])
  const [showArchive, setShowArchive] = useState(false)
  const [showTodoArchive, setShowTodoArchive] = useState(false)
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('MERGE')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [includeArchivedInExport, setIncludeArchivedInExport] = useState(true)
  const [showDebugInfo, setShowDebugInfo] = useState(false)
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => readStorageItem(LAST_BACKUP_AT_STORAGE_KEY))
  const [maintenanceLog, setMaintenanceLog] = useState<MaintenanceLogEntry[]>(() => readStoredMaintenanceLog())
  const [devSyncInfo, setDevSyncInfo] = useState<DevSyncInfo | null>(null)
  const [syncEnabled, setSyncEnabledState] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncUiStatus>('disabled')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncDiagnostics, setSyncDiagnostics] = useState<SyncDiagnostics | null>(null)
  const [syncPairCode, setSyncPairCode] = useState<string | null>(null)
  const [syncPairCodeDraft, setSyncPairCodeDraft] = useState('')
  const [syncRoomId, setSyncRoomId] = useState(() => readStorageItem(SYNC_ID_STORAGE_KEY) || DEFAULT_SYNC_ROOM_ID)
  const [syncNowBusy, setSyncNowBusy] = useState(false)
  const [showPairQr, setShowPairQr] = useState(false)
  const [pairQrValue, setPairQrValue] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [scannerHint, setScannerHint] = useState<string | null>(null)
  const [staleReviewMode, setStaleReviewMode] = useState(false)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextOptions, setContextOptions] = useState<ContextOption[]>(() => readStoredContextOptions())
  const [contextDraftLabels, setContextDraftLabels] = useState<Record<string, string>>({})
  const [newContextLabel, setNewContextLabel] = useState('')
  const [isContextEditMode, setIsContextEditMode] = useState(false)
  const [thinkingActionButtonWidth, setThinkingActionButtonWidth] = useState<number | null>(null)
  const [todoActionButtonWidth, setTodoActionButtonWidth] = useState<number | null>(null)
  const [reduceMainTabHelpers, setReduceMainTabHelpers] = useState(readReduceMainTabHelpersFlag)
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
  const [isInfoFadingOut, setIsInfoFadingOut] = useState(false)
  const undoTimeoutRef = useRef<number | null>(null)
  const todoUndoTimeoutRef = useRef<number | null>(null)
  const braindumpCaptureFeedbackTimeoutRef = useRef<number | null>(null)
  const braindumpCaptureFeedbackSeqRef = useRef(0)
  const transientInfoFadeTimeoutRef = useRef<number | null>(null)
  const transientInfoClearTimeoutRef = useRef<number | null>(null)
  const mainScrollRef = useRef<HTMLElement | null>(null)
  const braindumpEndRef = useRef<HTMLDivElement | null>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const contextMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const thinkingCtaButtonRef = useRef<HTMLButtonElement | null>(null)
  const thinkingArchiveButtonRef = useRef<HTMLButtonElement | null>(null)
  const todoCtaButtonRef = useRef<HTMLButtonElement | null>(null)
  const todoArchiveButtonRef = useRef<HTMLButtonElement | null>(null)
  const todoSearchInputRef = useRef<HTMLInputElement | null>(null)
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null)
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const nextAutoScrollBehaviorRef = useRef<ScrollBehavior>('auto')
  const hiddenAtRef = useRef<number | null>(null)
  const swReloadedRef = useRef(false)
  const refreshRunSeqRef = useRef(0)

  useEffect(() => {
    persistContextOptions(contextOptions)
  }, [contextOptions])

  useEffect(() => {
    writeStorageItem(REDUCE_MAIN_TAB_HELPERS_STORAGE_KEY, reduceMainTabHelpers ? '1' : '0')
  }, [reduceMainTabHelpers])

  useEffect(() => {
    writeStorageItem(MAINTENANCE_LOG_STORAGE_KEY, JSON.stringify(maintenanceLog.slice(0, MAINTENANCE_LOG_LIMIT)))
  }, [maintenanceLog])

  useEffect(() => {
    setContextDraftLabels((prev) => {
      const next: Record<string, string> = {}
      for (const option of contextOptions) {
        next[option.value] = prev[option.value] ?? option.label
      }
      return next
    })
  }, [contextOptions])

  const clearTransientInfoTimeouts = () => {
    if (transientInfoFadeTimeoutRef.current !== null) {
      window.clearTimeout(transientInfoFadeTimeoutRef.current)
      transientInfoFadeTimeoutRef.current = null
    }
    if (transientInfoClearTimeoutRef.current !== null) {
      window.clearTimeout(transientInfoClearTimeoutRef.current)
      transientInfoClearTimeoutRef.current = null
    }
  }

  const showTransientInfo = useCallback((message: string) => {
    clearTransientInfoTimeouts()
    setInfo(message)
    setIsInfoFadingOut(false)
    const fadeDelay = Math.max(0, FEEDBACK_VISIBILITY_MS - TRANSIENT_INFO_FADE_OUT_MS)
    transientInfoFadeTimeoutRef.current = window.setTimeout(() => {
      setIsInfoFadingOut(true)
      transientInfoFadeTimeoutRef.current = null
    }, fadeDelay)
    transientInfoClearTimeoutRef.current = window.setTimeout(() => {
      setInfo((current) => (current === message ? '' : current))
      setIsInfoFadingOut(false)
      transientInfoClearTimeoutRef.current = null
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
    return elapsedMs >= BACKUP_OVERDUE_DAYS * MS_PER_DAY
  }, [lastBackupAt])

  const refreshAll = useCallback(async (roomIdOverride?: string) => {
    const runSeq = ++refreshRunSeqRef.current
    try {
      const maintenanceMessages: string[] = []
      const maintenanceEntries: MaintenanceLogEntry[] = []
      const archiveCleanupRunDay = getLocalDayISO()
      if (readStorageItem(ARCHIVE_HARD_DELETE_LAST_RUN_KEY) !== archiveCleanupRunDay) {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - ARCHIVE_HARD_DELETE_DAYS)
        const cutoffISO = cutoffDate.toISOString()
        const hardDeleteCandidates = await listArchiveHardDeleteCandidates(cutoffISO, ARCHIVE_HARD_DELETE_BATCH_LIMIT)
        if (hardDeleteCandidates.length > 0) {
          await hardDeleteNotes(hardDeleteCandidates.map((note) => note.id))
          const message = `Archiv bereinigt: ${hardDeleteCandidates.length} Eintrag${hardDeleteCandidates.length === 1 ? '' : 'e'} endgültig gelöscht.`
          maintenanceMessages.push(message)
          maintenanceEntries.push({
            id: `archive-delete:${Date.now()}:${hardDeleteCandidates.length}`,
            at: new Date().toISOString(),
            message,
          })
        }
        writeStorageItem(ARCHIVE_HARD_DELETE_LAST_RUN_KEY, archiveCleanupRunDay)
      }

      const todoReturnCutoffDate = new Date(Date.now() - TODO_RETURN_TO_REVIEW_DAYS * MS_PER_DAY)
      const todoReturnCandidates = await listTodoReturnToInboxCandidates(
        todoReturnCutoffDate.toISOString(),
        TODO_RETURN_TO_REVIEW_BATCH_LIMIT,
      )
      if (todoReturnCandidates.length > 0) {
        await Promise.all(todoReturnCandidates.map((note) => updateNoteStatus(note.id, 'INBOX')))
        const message = `Wiedervorlage: ${todoReturnCandidates.length} alte Handlung${todoReturnCandidates.length === 1 ? '' : 'en'} zurück in die Inbox verschoben.`
        maintenanceMessages.push(message)
        maintenanceEntries.push({
          id: `todo-return:${Date.now()}:${todoReturnCandidates.length}`,
          at: new Date().toISOString(),
          message,
        })
      }

      if (maintenanceMessages.length > 0) {
        setMaintenanceLog((current) => [...maintenanceEntries.reverse(), ...current].slice(0, MAINTENANCE_LOG_LIMIT))
        showTransientInfo(maintenanceMessages.join(' '))
      }

      const activeRoomId = roomIdOverride ?? syncRoomId
      const [braindump, inbox, process, processTotal, todo, archived] = await Promise.all([
        listRecentActiveNotes(BRAINDUMP_FETCH_LIMIT),
        listInboxNotes(REVIEW_LIMIT),
        listNotesByStatus('PROCESS', 200),
        countNotesByStatus('PROCESS'),
        listTodoNotes(200),
        listNotesByStatus('ARCHIVE'),
      ])
      if (runSeq !== refreshRunSeqRef.current) {
        return
      }
      setBraindumpNotes(braindump)
      setInboxNotes(inbox)
      setProcessNotes(process)
      setProcessCount(processTotal)
      setTodoNotes(todo)
      setArchivedNotes(archived)
      const syncInfo = await getSyncDebugInfo(activeRoomId)
      if (runSeq !== refreshRunSeqRef.current) {
        return
      }
      setSyncEnabledState(syncInfo.isEnabled)
      setSyncPairCode(await getSyncPairCode(activeRoomId))
      setDevSyncInfo(syncInfo)
    } catch {
      if (runSeq !== refreshRunSeqRef.current) {
        return
      }
      setError('Daten konnten nicht geladen werden.')
    }
  }, [showTransientInfo, syncRoomId])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | null = null

    void loadSyncEngineModule()
      .then(({ startSyncEngine }) => {
        if (cancelled) {
          return
        }
        stop = startSyncEngine({
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
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setSyncStatus('error')
        setSyncError('Sync konnte nicht initialisiert werden.')
      })

    return () => {
      cancelled = true
      stop?.()
    }
  }, [refreshAll, syncRoomId])

  useEffect(() => {
    writeStorageItem(SYNC_ID_STORAGE_KEY, syncRoomId)
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
      const hasReviewEntries =
        inboxNotes.length > 0 || todoNotes.some((todo) => daysBetween(new Date(), new Date(todo.createdAt)) > 14)
      const hasThinkingEntries = processNotes.length > 0
      const hasTodoEntries = todoNotes.length > 0
      if (event.key === '1') {
        setActiveTab('BRAINDUMP')
        event.preventDefault()
      } else if (event.key === '2' && hasReviewEntries) {
        setActiveTab('REVIEW')
        event.preventDefault()
      } else if (event.key === '3' && hasThinkingEntries) {
        setActiveTab('THINKING')
        event.preventDefault()
      } else if (event.key === '4' && hasTodoEntries) {
        setActiveTab('TODO')
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inboxNotes.length, processNotes.length, todoNotes])

  useEffect(() => {
    if (!showContextMenu) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (contextMenuRef.current?.contains(target) || contextMenuButtonRef.current?.contains(target)) {
        return
      }
      setShowContextMenu(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowContextMenu(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [showContextMenu])

  useEffect(() => {
    setShowContextMenu(false)
  }, [activeTab])

  useEffect(() => {
    const closeOpenNoteActionMenus = () => {
      const openMenus = document.querySelectorAll<HTMLDetailsElement>('details.note-action-menu[open]')
      openMenus.forEach((menu) => {
        menu.open = false
      })
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        closeOpenNoteActionMenus()
        return
      }
      const clickedInsideNoteActionMenu = target instanceof Element && target.closest('details.note-action-menu')
      if (clickedInsideNoteActionMenu) {
        return
      }
      closeOpenNoteActionMenus()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOpenNoteActionMenus()
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
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
      const storedRoomId = readTrimmedStorageItem(SYNC_ID_STORAGE_KEY) ?? ''
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
    const storedRoomId = readTrimmedStorageItem(SYNC_ID_STORAGE_KEY) ?? ''
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
      writeStorageItem(SYNC_ID_STORAGE_KEY, roomId)
      setSyncRoomId(roomId)
      await updateSyncState(roomId, { isEnabled: false, lastError: null })
      const next = await setSyncEnabled(roomId, true)
      setSyncEnabledState(next.isEnabled)
      await refreshAll(roomId)
      showTransientInfo('Neuer Sync-Raum erstellt und Sync aktiviert. Du kannst jetzt den Pairing-Code teilen.')
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
      removeStorageItem(SYNC_ID_STORAGE_KEY)
      removeStorageItem(SYNC_TOKEN_STORAGE_KEY)
      removeStorageItem(SYNC_KEY_STORAGE_KEY)
      setShowPairQr(false)
      setShowScanner(false)
      setSyncRoomId(DEFAULT_SYNC_ROOM_ID)
      setSyncEnabledState(false)
      setSyncPairCode(null)
      setSyncDiagnostics(null)
      setSyncError(null)
      setInfo('')
      removeStorageItem(ONBOARDING_COMPLETED_STORAGE_KEY)
      window.location.reload()
      return
    } catch {
      setError('Client konnte nicht bereinigt werden.')
    }
  }, [syncRoomId])

  const performSyncNow = useCallback(
    async (roomId: string) => {
      const { syncNow } = await loadSyncEngineModule()
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
    },
    [refreshAll],
  )

  const handleSyncNow = useCallback(async () => {
    setSyncNowBusy(true)
    setError('')
    try {
      await performSyncNow(syncRoomId)
    } catch {
      setError('Sync now fehlgeschlagen.')
    } finally {
      setSyncNowBusy(false)
    }
  }, [performSyncNow, syncRoomId])

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
        maintenance: {
          todoFadeAfterDays: TODO_STALE_DAYS,
          todoReturnToReviewAfterDays: TODO_RETURN_TO_REVIEW_DAYS,
          archiveHardDeleteAfterDays: ARCHIVE_HARD_DELETE_DAYS,
          archiveHardDeleteLastRunDay: readStorageItem(ARCHIVE_HARD_DELETE_LAST_RUN_KEY),
        },
        localStorage: {
          syncId: readStorageItem(SYNC_ID_STORAGE_KEY),
          syncTokenMasked: maskSecret(readStorageItem(SYNC_TOKEN_STORAGE_KEY)),
          syncKeyMasked: maskSecret(readStorageItem(SYNC_KEY_STORAGE_KEY)),
          showDebugInfo: readStorageItem(SHOW_DEBUG_INFO_STORAGE_KEY),
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
        await performSyncNow(roomId)
      } finally {
        setSyncNowBusy(false)
      }
    },
    [performSyncNow],
  )

  const handleRekeySyncCluster = useCallback(async () => {
    setError('')
    if (!syncEnabled) {
      setError('Sync muss aktiv sein, um einen Client aus dem Verbund zu entfernen.')
      return
    }
    const confirmed = window.confirm(
      'Achtung: Dieses Gerät wird aus dem Sync-Verbund entfernt und wechselt in den lokalen Modus. Andere gekoppelte Geräte bleiben unverändert. Fortfahren?',
    )
    if (!confirmed) {
      return
    }

    const previousRoomId = syncRoomId
    const previousStorage = {
      roomId: readStorageItem(SYNC_ID_STORAGE_KEY),
      token: readStorageItem(SYNC_TOKEN_STORAGE_KEY),
      key: readStorageItem(SYNC_KEY_STORAGE_KEY),
    }
    try {
      removeStorageItem(SYNC_ID_STORAGE_KEY)
      removeStorageItem(SYNC_TOKEN_STORAGE_KEY)
      removeStorageItem(SYNC_KEY_STORAGE_KEY)
      setSyncRoomId(DEFAULT_SYNC_ROOM_ID)
      setSyncEnabledState(false)
      setSyncPairCode(null)
      setSyncPairCodeDraft('')

      await updateSyncState(previousRoomId, { isEnabled: false, lastError: null })

      setShowPairQr(false)
      setShowScanner(false)
      setSyncDiagnostics(null)
      setSyncError(null)
      await clearInboxSeen()
      await refreshAll(DEFAULT_SYNC_ROOM_ID)
      showTransientInfo('Client aus Verbund entfernt. Dieses Gerät läuft jetzt nur lokal.')
    } catch {
      setSyncRoomId(previousRoomId)
      if (previousStorage.roomId) {
        writeStorageItem(SYNC_ID_STORAGE_KEY, previousStorage.roomId)
      } else {
        removeStorageItem(SYNC_ID_STORAGE_KEY)
      }
      if (previousStorage.token) {
        writeStorageItem(SYNC_TOKEN_STORAGE_KEY, previousStorage.token)
      } else {
        removeStorageItem(SYNC_TOKEN_STORAGE_KEY)
      }
      if (previousStorage.key) {
        writeStorageItem(SYNC_KEY_STORAGE_KEY, previousStorage.key)
      } else {
        removeStorageItem(SYNC_KEY_STORAGE_KEY)
      }
      setError('Client konnte nicht aus dem Verbund entfernt werden.')
      await refreshAll(previousRoomId)
    }
  }, [refreshAll, showTransientInfo, syncEnabled, syncRoomId])

  const applyPairingPayload = useCallback(
    async (payload: PairingPayloadV1) => {
      const previousRoomId = syncRoomId
      const previousStorage = {
        roomId: readStorageItem(SYNC_ID_STORAGE_KEY),
        token: readStorageItem(SYNC_TOKEN_STORAGE_KEY),
        key: readStorageItem(SYNC_KEY_STORAGE_KEY),
      }
      const previousRoomState = await getSyncState(previousRoomId)
      const previousTargetState =
        payload.roomId === previousRoomId ? previousRoomState : await getSyncState(payload.roomId)

      writeStorageItem(SYNC_ID_STORAGE_KEY, payload.roomId)
      writeStorageItem(SYNC_TOKEN_STORAGE_KEY, payload.token)
      if (payload.key) {
        writeStorageItem(SYNC_KEY_STORAGE_KEY, payload.key)
      } else {
        removeStorageItem(SYNC_KEY_STORAGE_KEY)
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
            writeStorageItem(SYNC_ID_STORAGE_KEY, previousStorage.roomId)
            writeStorageItem(SYNC_TOKEN_STORAGE_KEY, previousStorage.token)
          } else {
            removeStorageItem(SYNC_ID_STORAGE_KEY)
            removeStorageItem(SYNC_TOKEN_STORAGE_KEY)
          }
          if (previousStorage.key) {
            writeStorageItem(SYNC_KEY_STORAGE_KEY, previousStorage.key)
          } else {
            removeStorageItem(SYNC_KEY_STORAGE_KEY)
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
      const syncKey = readTrimmedStorageItem(SYNC_KEY_STORAGE_KEY)
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
    let cancelled = false

    void loadQrCodeModule()
      .then((QRCode) => {
        if (cancelled || !qrCanvasRef.current) {
          return
        }
        return QRCode.toCanvas(qrCanvasRef.current, pairQrValue, {
          width: 256,
          margin: 2,
          errorCorrectionLevel: 'M',
        })
      })
      .catch(() => {
        if (!cancelled) {
          setError('QR-Code konnte nicht erzeugt werden.')
        }
      })

    return () => {
      cancelled = true
    }
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
        const { BrowserMultiFormatReader } = await loadZxingBrowserModule()
        if (!active) {
          return
        }
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
        return false
      }

      const nearBottom = isNearBottom()
      shouldAutoScrollRef.current = nearBottom
      nextAutoScrollBehaviorRef.current = nearBottom ? 'smooth' : 'auto'
      setError('')
      try {
        const parsedEntries = entries.map((entry) => parseBraindumpEntryForContext(entry, contextOptions))
        const hasEmptyContextOnlyEntry = parsedEntries.some((entry) => entry.context && entry.text.trim().length === 0)
        if (hasEmptyContextOnlyEntry) {
          setError('Ein Memo darf nicht nur aus einem Kontext bestehen.')
          return false
        }

        const created = await Promise.all(parsedEntries.map(async (parsed) => {
          const createdNote = await addNote(parsed.text)
          if (parsed.context) {
            await updateNoteContext(createdNote.id, parsed.context)
            return { ...createdNote, context: parsed.context }
          }
          return createdNote
        }))
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
          const taskCount = created.filter((note) => note.type === 'TASK' || note.status === 'TODO').length
          const baseFeedback =
            created.length === 1
              ? taskCount === 1
                ? 'Aufgabe angelegt.'
                : 'Gedanke erfasst.'
              : taskCount === 0
                ? `${created.length} Gedanken erfasst.`
                : taskCount === created.length
                  ? `${created.length} Aufgaben angelegt.`
                  : `${created.length} Einträge erfasst.`
          const assignedContexts = Array.from(
            new Set(parsedEntries.map((entry) => entry.context).filter((context): context is ContextTag => Boolean(context))),
          )
          const hashtagFeedback =
            assignedContexts.length === 0
              ? baseFeedback
              : assignedContexts.length === 1
                ? `${baseFeedback} #${assignedContexts[0]} als Kontext gesetzt und aus dem Text übernommen.`
                : `${baseFeedback} ${assignedContexts.length} Kontexte aus #Tags gesetzt und aus dem Text übernommen.`
          const nextFeedback: CaptureFeedback = {
            id: braindumpCaptureFeedbackSeqRef.current + 1,
            text: hashtagFeedback,
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
        return true
      } catch {
        setError('Notiz konnte nicht gespeichert werden.')
        return false
      }
    },
    [contextOptions, isNearBottom, refreshAll],
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
      clearTransientInfoTimeouts()
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
        if (options?.enableUndo) {
          const snapshot = options.sourceNote
          if (snapshot) {
            startUndoWindow({
              noteId: snapshot.id,
              prevStatus: snapshot.status,
              newStatus: status,
              at: Date.now(),
              restoresDelete: true,
            })
          }
        } else {
          clearUndoTimeout()
          setLastAction(null)
        }
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
      if (lastAction.restoresDelete) {
        await restoreNote(lastAction.noteId)
      }
      await updateNoteStatus(lastAction.noteId, lastAction.prevStatus)
      clearUndoTimeout()
      setLastAction(null)
      showTransientInfo('Rückgängig durchgeführt.')
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
      const { buildBackupData } = await loadBackupModule()
      const backup = await buildBackupData({ includeArchived: includeArchivedInExport })
      const day = getLocalDayISO()
      const filename = includeArchivedInExport ? `leiser-backup-mit-archiv-${day}.json` : `leiser-backup-${day}.json`
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
      writeStorageItem(LAST_BACKUP_AT_STORAGE_KEY, exportedAt)
      showTransientInfo(includeArchivedInExport ? 'Backup mit Archiv erzeugt.' : 'Backup erzeugt.')
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
      const { importBackupJson } = await loadBackupModule()
      const fileText = await importFile.text()
      const report = await importBackupJson(fileText, importMode)
      setImportReport(report)
      const clearedContextCount = await clearUnknownContexts(contextOptions.map((option) => option.value))
      if (clearedContextCount > 0) {
        showTransientInfo(
          `Backup importiert. ${clearedContextCount} Eintrag${clearedContextCount === 1 ? '' : 'e'} mit entferntem Kontext auf "Ohne Kontext" gesetzt.`,
        )
      } else {
        showTransientInfo('Backup erfolgreich importiert.')
      }
      setImportFile(null)
      setShowImportPanel(false)
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
  const hasConfiguredSyncRoom = syncRoomId.trim().length > 0 && syncRoomId.trim() !== DEFAULT_SYNC_ROOM_ID
  const hasAnyNotes =
    braindumpNotes.length > 0
    || inboxNotes.length > 0
    || processNotes.length > 0
    || todoNotes.length > 0
    || archivedNotes.length > 0
  const allContextOptions = useMemo(() => {
    const labels = new Map<ContextTag, string>()
    for (const option of contextOptions) {
      const key = normalizeContextTag(option.value)
      if (!key) {
        continue
      }
      labels.set(key, option.label)
    }
    for (const note of [...braindumpNotes, ...inboxNotes, ...processNotes, ...todoNotes, ...archivedNotes]) {
      const key = normalizeContextTag(note.context)
      if (!key || labels.has(key)) {
        continue
      }
      labels.set(key, capitalizeFirstCharacter(fallbackContextLabel(key)))
    }
    return Array.from(labels.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'de-DE'))
  }, [archivedNotes, braindumpNotes, contextOptions, inboxNotes, processNotes, todoNotes])
  const orphanedContextOptions = useMemo(() => {
    const configured = new Set(contextOptions.map((option) => normalizeContextTag(option.value)).filter(Boolean))
    return allContextOptions.filter((option) => !configured.has(normalizeContextTag(option.value)))
  }, [allContextOptions, contextOptions])
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
    }, allContextOptions)
  }, [allContextOptions, visibleProcessNotes])
  const thinkingArchivedNotes = useMemo(
    () => archivedNotes.filter((note) => isThinkingArchiveNote(note)),
    [archivedNotes],
  )
  const hasThinkingArchive = thinkingArchivedNotes.length > 0
  const visibleThinkingArchivedNotes = useMemo(() => {
    return thinkingArchivedNotes.filter((note) => matchesContextFilter(note, thinkingContextFilter))
  }, [thinkingArchivedNotes, thinkingContextFilter])
  const hasVisibleThinkingArchive = visibleThinkingArchivedNotes.length > 0
  const todoArchivedNotes = useMemo(
    () => archivedNotes.filter((note) => isTodoArchiveNote(note)),
    [archivedNotes],
  )
  const archiveWarnings = useMemo<ArchiveWarningEntry[]>(() => {
    const nowMs = Date.now()
    return archivedNotes
      .map((note) => {
        const daysLeft = daysUntilArchiveHardDelete(note, nowMs)
        if (daysLeft === null || daysLeft < 1 || daysLeft > ARCHIVE_WARNING_DAYS) {
          return null
        }
        return {
          id: note.id,
          text: trimPreviewText(note.text),
          daysLeft,
          scopeLabel: isTodoArchiveNote(note) ? 'Handlung im Archiv' : 'Memo im Archiv',
        }
      })
      .filter((entry): entry is ArchiveWarningEntry => entry !== null)
      .sort((a, b) => a.daysLeft - b.daysLeft || a.text.localeCompare(b.text, 'de-DE'))
  }, [archivedNotes])
  const thinkingArchiveWarnings = useMemo(
    () => archiveWarnings.filter((entry) => {
      const note = archivedNotes.find((candidate) => candidate.id === entry.id)
      return note ? isThinkingArchiveNote(note) : false
    }),
    [archiveWarnings, archivedNotes],
  )
  const todoArchiveWarnings = useMemo(
    () => archiveWarnings.filter((entry) => {
      const note = archivedNotes.find((candidate) => candidate.id === entry.id)
      return note ? isTodoArchiveNote(note) : false
    }),
    [archiveWarnings, archivedNotes],
  )
  const hasTodoArchive = todoArchivedNotes.length > 0
  const normalizedTodoSearchQuery = useMemo(() => todoSearchQuery.trim().toLocaleLowerCase('de-DE'), [todoSearchQuery])
  const thinkingArchiveCount = visibleThinkingArchivedNotes.length
  const visibleTodoArchivedNotes = useMemo(() => {
    return todoArchivedNotes.filter((note) => {
      if (!matchesContextFilter(note, todoContextFilter)) {
        return false
      }
      if (!matchesTodoSearch(note, normalizedTodoSearchQuery)) {
        return false
      }
      return true
    })
  }, [todoArchivedNotes, todoContextFilter, normalizedTodoSearchQuery])
  const todoArchiveCount = visibleTodoArchivedNotes.length
  const hasVisibleTodoArchive = visibleTodoArchivedNotes.length > 0
  const archivedThinkingGroups = useMemo(() => {
    return groupNotesByContext(visibleThinkingArchivedNotes, (a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
      if (byUpdated !== 0) {
        return byUpdated
      }
      return b.createdAt.localeCompare(a.createdAt)
    }, allContextOptions)
  }, [allContextOptions, visibleThinkingArchivedNotes])
  const archivedTodoGroups = useMemo(() => {
    return groupNotesByContext(visibleTodoArchivedNotes, (a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
      if (byUpdated !== 0) {
        return byUpdated
      }
      return b.createdAt.localeCompare(a.createdAt)
    }, allContextOptions)
  }, [allContextOptions, visibleTodoArchivedNotes])
  const thinkingContextOptions = useMemo(() => {
    const used = new Set<ContextTag>()
    for (const note of processNotes) {
      const key = normalizeContextTag(note.context)
      if (key) used.add(key)
    }
    for (const note of thinkingArchivedNotes) {
      const key = normalizeContextTag(note.context)
      if (key) used.add(key)
    }
    return allContextOptions.filter((option) => used.has(normalizeContextTag(option.value) ?? option.value))
  }, [allContextOptions, processNotes, thinkingArchivedNotes])
  const thinkingHasNoContextNotes = useMemo(() => {
    return [...processNotes, ...thinkingArchivedNotes].some((note) => !note.context)
  }, [processNotes, thinkingArchivedNotes])
  const todoContextOptions = useMemo(() => {
    const used = new Set<ContextTag>()
    for (const note of todoNotes) {
      const key = normalizeContextTag(note.context)
      if (key) used.add(key)
    }
    for (const note of todoArchivedNotes) {
      const key = normalizeContextTag(note.context)
      if (key) used.add(key)
    }
    return allContextOptions.filter((option) => used.has(normalizeContextTag(option.value) ?? option.value))
  }, [allContextOptions, todoNotes, todoArchivedNotes])
  const todoHasNoContextNotes = useMemo(() => {
    return [...todoNotes, ...todoArchivedNotes].some((note) => !note.context)
  }, [todoNotes, todoArchivedNotes])

  useEffect(() => {
    if (activeTab !== 'THINKING') {
      return
    }
    if (!thinkingContextFilter) {
      return
    }
    if (thinkingContextFilter === '__none') {
      if (!thinkingHasNoContextNotes) {
        setThinkingContextFilter('')
      }
      return
    }
    if (!thinkingContextOptions.some((option) => normalizeContextTag(option.value) === normalizeContextTag(thinkingContextFilter))) {
      setThinkingContextFilter('')
    }
  }, [activeTab, thinkingContextFilter, thinkingContextOptions, thinkingHasNoContextNotes])

  useEffect(() => {
    if (activeTab !== 'TODO') {
      return
    }
    if (!todoContextFilter) {
      return
    }
    if (todoContextFilter === '__none') {
      if (!todoHasNoContextNotes) {
        setTodoContextFilter('')
      }
      return
    }
    if (!todoContextOptions.some((option) => normalizeContextTag(option.value) === normalizeContextTag(todoContextFilter))) {
      setTodoContextFilter('')
    }
  }, [activeTab, todoContextFilter, todoContextOptions, todoHasNoContextNotes])

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
          scope: 'TODO',
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
          scope: 'TODO',
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

  const handleTodoToThinking = useCallback(
    (id: string) => {
      void handleTodoStatusChange(id, 'PROCESS')
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
  const handleTodoSaveEdit = useCallback(
    async (id: string, text: string, context: ContextTag | undefined) => {
      setError('')
      try {
        await updateNoteText(id, text)
        await updateNoteContext(id, context)
        await refreshAll()
        return true
      } catch {
        setError('Handlung konnte nicht bearbeitet werden.')
        return false
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
        setError('Kontext konnte nicht aktualisiert werden.')
      }
    },
    [refreshAll],
  )
  const handleReviewSaveEdit = useCallback(
    async (id: string, text: string, context: ContextTag | undefined) => {
      setError('')
      try {
        await updateNoteText(id, text)
        await updateNoteContext(id, context)
        await refreshAll()
        return true
      } catch {
        setError('Eintrag konnte nicht bearbeitet werden.')
        return false
      }
    },
    [refreshAll],
  )

  const handleSaveContextOptionLabel = useCallback(async (value: ContextTag) => {
    setError('')
    const draft = normalizeContextLabel(contextDraftLabels[value])
    const nextValue = normalizeContextTag(draft)
    if (!draft || !nextValue) {
      setError('Kontextname darf nicht leer sein.')
      return
    }

    const currentValue = normalizeContextTag(value)
    const hasDuplicate = contextOptions.some((option) => {
      const optionValue = normalizeContextTag(option.value)
      return optionValue !== currentValue && optionValue === nextValue
    })
    if (hasDuplicate) {
      setError('Kontext existiert bereits.')
      return
    }

    try {
      await replaceContextAcrossNotes(value, nextValue)
      setContextOptions((prev) =>
        prev
          .map((option) => (option.value === value ? { value: nextValue, label: capitalizeFirstCharacter(draft) } : option))
          .sort((a, b) => a.label.localeCompare(b.label, 'de-DE')),
      )
      showTransientInfo('Kontext aktualisiert.')
      await refreshAll()
    } catch {
      setError('Kontext konnte nicht aktualisiert werden.')
    }
  }, [contextDraftLabels, contextOptions, refreshAll, showTransientInfo])

  const handleDeleteContextOption = useCallback(async (value: ContextTag) => {
    const displayLabel =
      contextOptions.find((option) => normalizeContextTag(option.value) === normalizeContextTag(value))?.label
      ?? capitalizeFirstCharacter(value)
    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(
        `Kontext "${displayLabel}" wirklich entfernen?\n\nAlle zugeordneten Einträge werden auf "Ohne Kontext" gesetzt.`,
      )
    if (!confirmed) {
      return
    }
    setError('')
    try {
      const changed = await replaceContextAcrossNotes(value, undefined)
      setContextOptions((prev) => prev.filter((option) => option.value !== value))
      showTransientInfo(
        changed > 0
          ? `Kontext entfernt. ${changed} Eintrag${changed === 1 ? '' : 'e'} jetzt ohne Kontext.`
          : 'Kontext entfernt.',
      )
      await refreshAll()
    } catch {
      setError('Kontext konnte nicht entfernt werden.')
    }
  }, [contextOptions, refreshAll, showTransientInfo])

  const handleAddContextOption = useCallback(() => {
    const label = normalizeContextLabel(newContextLabel)
    if (!label) {
      setError('Bitte Namen für den Kontext eingeben.')
      return
    }
    if (contextOptions.length >= MAX_CONTEXT_OPTIONS) {
      setError(`Maximal ${MAX_CONTEXT_OPTIONS} Kontexte erlaubt.`)
      return
    }
    const value = normalizeContextTag(label)
    if (!value) {
      setError('Kontext konnte nicht erstellt werden.')
      return
    }
    setContextOptions((prev) => {
      if (prev.some((option) => normalizeContextTag(option.value) === value)) {
        setError('Kontext existiert bereits.')
        return prev
      }
      return [...prev, { value, label: capitalizeFirstCharacter(label) }].sort((a, b) => a.label.localeCompare(b.label, 'de-DE'))
    })
    setNewContextLabel('')
    showTransientInfo('Kontext hinzugefügt.')
  }, [contextOptions.length, newContextLabel, showTransientInfo])

  const handleUndoLastTodoAction = async () => {
    if (!lastTodoAction || todoUndoBusy) {
      return
    }

    setTodoUndoBusy(true)
    setError('')
    try {
      if (lastTodoAction.restoresDelete) {
        await restoreNote(lastTodoAction.noteId)
      }
      await updateNoteStatus(lastTodoAction.noteId, lastTodoAction.prevStatus)
      clearTodoUndoTimeout()
      setLastTodoAction(null)
      showTransientInfo('Rückgängig durchgeführt.')
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
        setError('Memo konnte nicht archiviert werden.')
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
  const handleThinkingSaveEdit = useCallback(
    async (id: string, text: string, context: ContextTag | undefined) => {
      setError('')
      try {
        await updateNoteText(id, text)
        await updateNoteContext(id, context)
        await refreshAll()
        return true
      } catch {
        setError('Memo konnte nicht bearbeitet werden.')
        return false
      }
    },
    [refreshAll],
  )
  const handleArchivedBackToThinking = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'PROCESS')
    },
    [handleReviewDecision],
  )
  const handleThinkingArchiveDiscard = useCallback(
    async (id: string) => {
      const sourceNote = thinkingArchivedNotes.find((note) => note.id === id)
      if (!sourceNote) {
        return
      }
      setError('')
      try {
        await deleteNote(id)
        startTodoUndoWindow({
          noteId: sourceNote.id,
          prevStatus: sourceNote.status,
          newStatus: 'DISCARD',
          at: Date.now(),
          restoresDelete: true,
          scope: 'THINKING',
        })
        if (thinkingArchiveCount <= 1) {
          setShowArchive(false)
        }
        showTransientInfo('Memo aus Archiv gelöscht.')
        await refreshAll()
      } catch {
        setError('Memo konnte nicht gelöscht werden.')
      }
    },
    [refreshAll, showTransientInfo, startTodoUndoWindow, thinkingArchiveCount, thinkingArchivedNotes],
  )
  const handleArchivedBackToTodo = useCallback(
    (id: string) => {
      void handleReviewDecision(id, 'TODO')
    },
    [handleReviewDecision],
  )
  const handleTodoArchiveDiscard = useCallback(
    async (id: string) => {
      const sourceNote = todoArchivedNotes.find((note) => note.id === id)
      if (!sourceNote) {
        return
      }
      setError('')
      try {
        await deleteNote(id)
        startTodoUndoWindow({
          noteId: sourceNote.id,
          prevStatus: sourceNote.status,
          newStatus: 'DISCARD',
          at: Date.now(),
          restoresDelete: true,
          scope: 'TODO',
        })
        if (todoArchiveCount <= 1) {
          setShowTodoArchive(false)
        }
        showTransientInfo('Handlung aus Archiv gelöscht.')
        await refreshAll()
      } catch {
        setError('Handlung konnte nicht gelöscht werden.')
      }
    },
    [refreshAll, showTransientInfo, startTodoUndoWindow, todoArchiveCount, todoArchivedNotes],
  )
  const handleClearThinkingArchive = useCallback(async () => {
    setError('')
    try {
      const archived = await listNotesByStatus('ARCHIVE', ARCHIVE_CLEAR_FETCH_LIMIT)
      const targetIds = archived.filter((note) => isThinkingArchiveNote(note)).map((note) => note.id)
      if (targetIds.length === 0) {
        showTransientInfo('Memos-Archiv ist bereits leer.')
        await refreshAll()
        return
      }
      const confirmed = window.confirm(
        `Wirklich ${targetIds.length} Memo${targetIds.length === 1 ? '' : 's'} endgültig aus dem Archiv löschen? Dieser Schritt kann nicht rückgängig gemacht werden.`,
      )
      if (!confirmed) {
        return
      }
      for (const id of targetIds) {
        await deleteNote(id)
      }
      setShowArchive(false)
      showTransientInfo(`${targetIds.length} Memo${targetIds.length === 1 ? '' : 's'} gelöscht.`)
      await refreshAll()
    } catch {
      setError('Memos-Archiv konnte nicht geleert werden.')
    }
  }, [refreshAll, showTransientInfo])
  const handleClearTodoArchive = useCallback(async () => {
    setError('')
    try {
      const archived = await listNotesByStatus('ARCHIVE', ARCHIVE_CLEAR_FETCH_LIMIT)
      const targetIds = archived.filter((note) => isTodoArchiveNote(note)).map((note) => note.id)
      if (targetIds.length === 0) {
        showTransientInfo('Handlungen-Archiv ist bereits leer.')
        await refreshAll()
        return
      }
      const confirmed = window.confirm(
        `Wirklich ${targetIds.length} Handlung${targetIds.length === 1 ? '' : 'en'} endgültig aus dem Archiv löschen? Dieser Schritt kann nicht rückgängig gemacht werden.`,
      )
      if (!confirmed) {
        return
      }
      for (const id of targetIds) {
        await deleteNote(id)
      }
      setShowTodoArchive(false)
      showTransientInfo(`${targetIds.length} Handlung${targetIds.length === 1 ? '' : 'en'} gelöscht.`)
      await refreshAll()
    } catch {
      setError('Handlungen-Archiv konnte nicht geleert werden.')
    }
  }, [refreshAll, showTransientInfo])

  const visibleTodoNotes = useMemo(() => {
    return todoNotes.filter((note) => {
      if (todoStarOnly && !note.starred) {
        return false
      }
      if (!matchesContextFilter(note, todoContextFilter)) {
        return false
      }
      if (!matchesTodoSearch(note, normalizedTodoSearchQuery)) {
        return false
      }
      return true
    })
  }, [todoNotes, todoStarOnly, todoContextFilter, normalizedTodoSearchQuery])

  const todoFiltersSummary = useMemo(() => {
    const parts: string[] = []
    if (todoStarOnly) {
      parts.push('mit Stern')
    }
    if (todoContextFilter) {
      parts.push(`in ${contextFilterPhrase(todoContextFilter, allContextOptions)}`)
    }
    if (normalizedTodoSearchQuery) {
      parts.push(`für "${todoSearchQuery.trim()}"`)
    }
    if (parts.length === 0) {
      return 'Keine passenden Handlungen.'
    }
    return `Keine Handlungen ${parts.join(' ')}.`
  }, [allContextOptions, normalizedTodoSearchQuery, todoContextFilter, todoSearchQuery, todoStarOnly])

  const todoGroups = useMemo(() => {
    return groupNotesByContext(visibleTodoNotes, (a, b) => {
      if (a.starred !== b.starred) {
        return a.starred ? -1 : 1
      }
      return b.createdAt.localeCompare(a.createdAt)
    }, allContextOptions)
  }, [allContextOptions, visibleTodoNotes])

  const reviewTabDisabled = orderedInbox.length === 0 && staleTodos.length === 0
  const thinkingTabDisabled = processNotes.length === 0 && thinkingArchivedNotes.length === 0
  const todoTabDisabled = todoNotes.length === 0 && todoArchivedNotes.length === 0

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

  useEffect(() => {
    if (
      (activeTab === 'REVIEW' && reviewTabDisabled)
      || (activeTab === 'THINKING' && thinkingTabDisabled)
      || (activeTab === 'TODO' && todoTabDisabled)
    ) {
      setActiveTab('BRAINDUMP')
    }
  }, [activeTab, reviewTabDisabled, thinkingTabDisabled, todoTabDisabled])

  useLayoutEffect(() => {
    const ctaButton = thinkingCtaButtonRef.current
    const archiveButton = thinkingArchiveButtonRef.current
    if (!ctaButton || !archiveButton) {
      setThinkingActionButtonWidth(null)
      return
    }
    const nextWidth = Math.ceil(Math.max(ctaButton.scrollWidth, archiveButton.scrollWidth))
    setThinkingActionButtonWidth((current) => (current === nextWidth ? current : nextWidth))
  }, [hasThinkingArchive, processCount, showArchive, thinkingArchiveCount])

  useLayoutEffect(() => {
    const ctaButton = todoCtaButtonRef.current
    const archiveButton = todoArchiveButtonRef.current
    if (!ctaButton || !archiveButton) {
      setTodoActionButtonWidth(null)
      return
    }
    const nextWidth = Math.ceil(Math.max(ctaButton.scrollWidth, archiveButton.scrollWidth))
    setTodoActionButtonWidth((current) => (current === nextWidth ? current : nextWidth))
  }, [hasTodoArchive, showTodoArchive, todoArchiveCount, todoNotes.length])

  useEffect(() => {
    if (!hasThinkingArchive && showArchive) {
      setShowArchive(false)
    }
  }, [hasThinkingArchive, showArchive])

  useEffect(() => {
    if (!hasTodoArchive && showTodoArchive) {
      setShowTodoArchive(false)
    }
  }, [hasTodoArchive, showTodoArchive])

  const openContextScreen = useCallback((tab: Extract<TabKey, 'SETTINGS' | 'DATA' | 'BACKUP' | 'ABOUT' | 'CONTEXTS'>) => {
    setActiveTab(tab)
    setShowContextMenu(false)
  }, [])

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
            <div className="mode-tabs" role="tablist" aria-label="Kontexte">
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
              className={
                activeTab === 'REVIEW'
                  ? 'tab-button tab-button--active'
                  : reviewTabDisabled
                    ? 'tab-button tab-button--disabled'
                    : 'tab-button'
              }
              onClick={() => setActiveTab('REVIEW')}
              aria-label="Inbox"
              title={reviewTabDisabled ? 'Inbox (noch nichts zu ordnen)' : 'Inbox'}
              disabled={reviewTabDisabled}
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
                <span>Inbox</span>
              </span>
            </button>
            <button
              type="button"
              className={
                activeTab === 'THINKING'
                  ? 'tab-button tab-button--active'
                  : thinkingTabDisabled
                    ? 'tab-button tab-button--disabled'
                    : 'tab-button'
              }
              onClick={() => setActiveTab('THINKING')}
              aria-label="Memos"
              title={thinkingTabDisabled ? 'Memos (noch keine Memos vorhanden)' : 'Memos'}
              disabled={thinkingTabDisabled}
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
                <span>Memos</span>
              </span>
            </button>
            <button
              type="button"
              className={
                activeTab === 'TODO'
                  ? 'tab-button tab-button--active'
                  : todoTabDisabled
                    ? 'tab-button tab-button--disabled'
                    : 'tab-button'
              }
              onClick={() => setActiveTab('TODO')}
              aria-label="Machen"
              title={todoTabDisabled ? 'Machen (noch keine Handlungen vorhanden)' : 'Machen'}
              disabled={todoTabDisabled}
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
                <span>Machen</span>
              </span>
            </button>
            </div>

          <div className="header-actions">
            {syncStatus === 'offline' ? <span className="sync-pill">Offline</span> : null}
            {syncStatus === 'error' ? <span className="sync-pill sync-pill--error">Sync Fehler</span> : null}
            <button
              type="button"
              className="icon-button"
              ref={contextMenuButtonRef}
              onClick={() => setShowContextMenu((prev) => !prev)}
              aria-label="Kontextmenü öffnen"
              aria-haspopup="menu"
              aria-expanded={showContextMenu}
              title="Kontextmenü"
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
            {showContextMenu ? (
              <div ref={contextMenuRef} className="context-menu" role="menu" aria-label="Kontextmenü">
                <button type="button" className="context-menu__item" role="menuitem" onClick={() => openContextScreen('SETTINGS')}>
                  Einstellungen
                </button>
                <button type="button" className="context-menu__item" role="menuitem" onClick={() => openContextScreen('ABOUT')}>
                  Über Leiser
                </button>
              </div>
            ) : null}
          </div>
        </div>
      }
    >
      <section className="app-content">
            {activeTab === 'SETTINGS' ? (
              <section className="data-section" aria-label="Einstellungen">
                <FlowHero
                  title="Einstellungen"
                  subtitle="Hier verwaltest du Daten, Sync und Kontexte."
                />
                <div className="data-panel">
                  <div className="data-layout">
                    <article className="data-card">
                      <h3>Allgemein</h3>
                      <p className="data-card__intro">
                        Öffne die gewünschten Einstellungen über die Schaltflächen.
                      </p>
                      <div className="data-actions settings-actions">
                        <div className="settings-action-item">
                          <button
                            type="button"
                            className="review-btn review-btn--cta"
                            onClick={() => setActiveTab('CONTEXTS')}
                          >
                            Kontexte bearbeiten
                          </button>
                        </div>
                        <div className="settings-action-item">
                          <button
                            type="button"
                            className="review-btn review-btn--cta"
                            onClick={() => setActiveTab('BACKUP')}
                          >
                            Backup
                          </button>
                        </div>
                        <div className="settings-action-item">
                          <button
                            type="button"
                            className="review-btn review-btn--process"
                            onClick={() => setActiveTab('DATA')}
                          >
                            Geräte-Sync (optional)
                          </button>
                        </div>
                      </div>
                      <label className="settings-option">
                        <input
                          type="checkbox"
                          checked={reduceMainTabHelpers}
                          onChange={(event) => setReduceMainTabHelpers(event.target.checked)}
                        />
                        <span>Hilfetexte in Haupt-Tabs reduzieren</span>
                      </label>
                      <p className="hint">
                        Blendet die erklärenden Untertitel in Inbox, Memos und Machen aus.
                      </p>
                    </article>
                    <article className="data-card">
                      <h3>Übrigens</h3>
                      <p className="data-card__intro">
                        Ein paar kurze Tipps, die Leiser im Alltag schneller machen:
                      </p>
                      <ul className="settings-tips-list">
                        <li>
                          Mit <code>-</code> am Anfang landet ein Eintrag direkt in <strong>Machen</strong>.
                        </li>
                        <li>
                          Mit <code>:</code> am Anfang landet ein Eintrag direkt in <strong>Memos</strong>.
                        </li>
                        <li>
                          Mit <code>#kontext</code> ordnest du beim Schreiben sofort einen Kontext zu.
                        </li>
                        <li>
                          Mit den Tasten <code>1</code> bis <code>4</code> wechselst du schnell zwischen den Hauptbereichen.
                        </li>
                        <li>
                          In den <code>...</code>-Menüs kannst du Einträge schnell verschieben, bearbeiten oder archivieren.
                        </li>
                      </ul>
                    </article>
                  </div>
                </div>
              </section>
            ) : null}
            {activeTab === 'DATA' ? (
              <DataScreen
                onBackToSettings={() => setActiveTab('SETTINGS')}
                onToggleSyncEnabled={() => void handleToggleSyncEnabled()}
                onCreateSyncRoom={() => void handleCreateSyncRoom()}
                onRekeySyncCluster={() => void handleRekeySyncCluster()}
                onWipeClient={() => void handleWipeClient()}
                syncEnabled={syncEnabled}
                hasConfiguredSyncRoom={hasConfiguredSyncRoom}
                onToggleDebugInfo={() => setShowDebugInfo((prev) => !prev)}
                showDebugInfo={showDebugInfo}
                onSyncNow={() => void handleSyncNow()}
                onCopySyncProtocol={() => void handleCopySyncProtocol()}
                syncNowBusy={syncNowBusy}
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
                maintenanceLog={maintenanceLog}
                archiveWarnings={archiveWarnings}
              />
            ) : null}
            {activeTab === 'BACKUP' ? (
              <BackupScreen
                onBackToSettings={() => setActiveTab('SETTINGS')}
                onExport={() => void handleExport()}
                showImportPanel={showImportPanel}
                onToggleImportPanel={() => setShowImportPanel((prev) => !prev)}
                onImportFileChange={setImportFile}
                importMode={importMode}
                onImportModeChange={setImportMode}
                onImport={() => void handleImport()}
                lastBackupAtLabel={toBackupTimeLabel(lastBackupAt)}
                backupOverdue={backupOverdue}
                importReport={importReport}
                info={info}
                offlineReady={offlineReady}
                includeArchivedInExport={includeArchivedInExport}
                onToggleIncludeArchivedInExport={setIncludeArchivedInExport}
              />
            ) : null}
            {activeTab === 'CONTEXTS' ? (
              <section className="data-section" aria-label="Kontexte verwalten">
                <FlowHero
                  title="Kontexte verwalten"
                  subtitle=""
                />
                <div className="data-panel">
                  <div className="settings-subnav">
                    <button
                      type="button"
                      className="settings-subnav__back-btn"
                      onClick={() => {
                        setIsContextEditMode(false)
                        setActiveTab('SETTINGS')
                      }}
                    >
                      Zurück zu Einstellungen
                    </button>
                  </div>
                  <div className="data-layout">
                    <article className="data-card">
                      <div className="context-editor-head">
                        <h3>Kontexte</h3>
                        <button
                          type="button"
                          className="review-btn review-btn--cta"
                          onClick={() => setIsContextEditMode((prev) => !prev)}
                        >
                          {isContextEditMode ? 'Fertig' : 'Bearbeiten'}
                        </button>
                      </div>
                      <p className="context-editor-meta">
                        {contextOptions.length} {contextOptions.length === 1 ? 'Kontext' : 'Kontexte'}
                      </p>
                      <p className="data-card__intro">
                        {isContextEditMode
                          ? 'Namen ändern, entfernen oder neue Kontexte hinzufügen.'
                          : 'Diesen Kontexten kannst du Handlungen zuordnen.'}
                      </p>
                      <div
                        className={isContextEditMode ? 'context-editor-help context-editor-help--warning' : 'context-editor-help'}
                        role="note"
                        aria-label="Hinweise zu Kontexten"
                      >
                        {!isContextEditMode ? (
                          <>
                            <p>
                              Bei der Eingabe in <strong>Erfassen</strong> kannst du einen Kontext direkt mit `#kontext` setzen,
                              zum Beispiel: `Anruf mit Team #arbeit`.
                            </p>
                            <p>
                              Beim Speichern wird der `#kontext`-Tag als Kontext übernommen und aus dem Notiztext entfernt.
                            </p>
                          </>
                        ) : null}
                        {isContextEditMode ? (
                          <>
                            <p>Beim Löschen eines Kontexts werden zugeordnete Einträge auf "Ohne Kontext" gesetzt.</p>
                            <p>Beim Umbenennen wird der neue Name in bestehenden Einträgen übernommen.</p>
                          </>
                        ) : null}
                      </div>
                      <div className={isContextEditMode ? 'context-editor-list' : 'context-editor-list context-editor-list--readonly'}>
                        {contextOptions.map((option) => (
                          <div
                            key={option.value}
                            className={isContextEditMode ? 'context-editor-row' : 'context-editor-row context-editor-row--readonly'}
                          >
                            {isContextEditMode ? (
                              <>
                                <input
                                  type="text"
                                  className="context-editor-input"
                                  value={contextDraftLabels[option.value] ?? option.label}
                                  onChange={(event) =>
                                    setContextDraftLabels((prev) => ({ ...prev, [option.value]: event.target.value }))
                                  }
                                  placeholder="Name"
                                  aria-label={`Kontext ${option.value} umbenennen`}
                                />
                                <button
                                  type="button"
                                  className="review-btn review-btn--process"
                                  onClick={() => void handleSaveContextOptionLabel(option.value)}
                                >
                                  Speichern
                                </button>
                                <button
                                  type="button"
                                  className="danger-btn danger-btn--critical"
                                  onClick={() => void handleDeleteContextOption(option.value)}
                                >
                                  Entfernen
                                </button>
                              </>
                            ) : (
                              <span className="context-editor-label">{option.label}</span>
                            )}
                          </div>
                        ))}
                      </div>

                      {isContextEditMode && contextOptions.length < MAX_CONTEXT_OPTIONS ? (
                        <div className="context-editor-add-panel">
                          <h3>Neuer Kontext</h3>
                          <div className="context-editor-add">
                            <input
                              type="text"
                              className="context-editor-input"
                              value={newContextLabel}
                              onChange={(event) => setNewContextLabel(event.target.value)}
                              placeholder="z. B. Weiterbildung"
                              aria-label="Neuer Kontext"
                            />
                            <button
                              type="button"
                              className="review-btn review-btn--todo"
                              onClick={handleAddContextOption}
                              disabled={contextOptions.length >= MAX_CONTEXT_OPTIONS}
                              title={
                                contextOptions.length >= MAX_CONTEXT_OPTIONS
                                  ? `Maximal ${MAX_CONTEXT_OPTIONS} Kontexte erlaubt`
                                  : 'Kontext hinzufügen'
                              }
                            >
                              Hinzufügen
                            </button>
                          </div>
                          {orphanedContextOptions.length > 0 ? (
                            <>
                              <p className="hint">
                                Diese Kontexte kommen in bestehenden Einträgen vor, sind aber noch nicht in deiner Kontextliste:
                              </p>
                              <ul className="context-editor-orphan-list" aria-label="Verwendete, nicht konfigurierte Kontexte">
                                {orphanedContextOptions.map((option) => (
                                  <li key={option.value}>{capitalizeFirstCharacter(option.label)}</li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  </div>
                </div>
              </section>
            ) : null}
            {activeTab === 'ABOUT' ? <AboutScreen onBackToCapture={() => setActiveTab('BRAINDUMP')} /> : null}

            <div className="tab-content">
          {activeTab === 'BRAINDUMP' ? (
            <BraindumpPage
              captureFeedback={braindumpCaptureFeedback}
              endRef={braindumpEndRef}
              showInboxEmptyState={!hasAnyNotes}
              onSubmitEntries={handleBraindumpSubmitEntries}
              contextOptions={contextOptions}
            />
          ) : null}

          {activeTab === 'REVIEW' ? (
            <>
              <FlowHero
                title="Dein Eingang"
                subtitle={reduceMainTabHelpers ? '' : 'Hier entscheidest du pro Eintrag: als Memo speichern, in Handlung überführen oder verwerfen.'}
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
                        Zu Memos
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
                    <p className="hint">Du kannst direkt mit bestehenden Memos oder Handlungen weiterarbeiten.</p>
                    <div className="review-empty-cta-actions">
                      <button type="button" className="review-btn review-btn--cta" onClick={() => setActiveTab('THINKING')}>
                        Zu Memos
                      </button>
                      <button type="button" className="review-btn review-btn--cta" onClick={() => setActiveTab('TODO')}>
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
                        <ReviewNoteRow
                          key={note.id}
                          note={note}
                          contextOptions={allContextOptions}
                          onContextChange={(id, context) => void handleReviewContextChange(id, context)}
                          onToTodo={(id) => void handleReviewDecision(id, 'TODO', { enableUndo: true, sourceNote: note })}
                          onToMemos={(id) => void handleReviewDecision(id, 'PROCESS', { enableUndo: true, sourceNote: note })}
                          onDiscard={(id) => void handleReviewDecision(id, 'DISCARD', { enableUndo: true, sourceNote: note })}
                          onSaveEdit={handleReviewSaveEdit}
                        />
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
              <p className="review-footer-hint">
                Kontexte kannst du jederzeit in den Einstellungen anpassen.
                {' '}
                <button
                  type="button"
                  className="text-link-btn"
                  onClick={() => setActiveTab('SETTINGS')}
                >
                  Einstellungen öffnen
                </button>
              </p>
            </>
          ) : null}

          {activeTab === 'THINKING' ? (
            <>
            <FlowHero
              title="Deine Memos"
              subtitle={reduceMainTabHelpers ? '' : 'Hier sammelst du offene Gedanken, bevor sie zu konkreten Handlungen werden.'}
            />
            <div className="todo-filter-row">
              <label className="context-select-wrap">
                <span className="sr-only">Kontext filtern</span>
                <select
                  className="context-select context-select--filter"
                  value={thinkingContextFilter}
                  onChange={(event) => setThinkingContextFilter(event.target.value as ContextFilter)}
                  aria-label="Kontext filtern"
                  title="Kontext filtern"
                >
                  <option value="">Alle Kontexte</option>
                  <option value="__none">Ohne Kontext</option>
                  {thinkingContextOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {lastTodoAction && lastTodoAction.scope === 'THINKING' ? (
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
            {processCount === 0 ? (
              <section className="review-empty-cta" aria-label="Memos leer">
                <p className="empty-text">Keine offenen Memos.</p>
                <p className="hint">Starte mit einem neuen Memo in Erfassen.</p>
                <div className="review-empty-cta-actions">
                  <button
                    type="button"
                    className="review-btn review-btn--cta"
                    onClick={() => setActiveTab('BRAINDUMP')}
                    ref={thinkingCtaButtonRef}
                    style={thinkingActionButtonWidth ? { width: `${thinkingActionButtonWidth}px` } : undefined}
                  >
                    Gedanken erfassen
                  </button>
                </div>
              </section>
            ) : null}
            {processCount > 0 && visibleProcessNotes.length === 0 ? (
              <p className="empty-text">
                {thinkingContextFilter === '__none'
                  ? 'Keine Memos ohne Kontext.'
                  : 'Keine Memos mit diesem Kontext.'}
              </p>
            ) : null}
            {thinkingGroups.map((group) => (
              <section key={group.contextKey} className="note-group">
                <div className="day-divider">{group.label}</div>
                <ul className="notes-list" aria-label={`Memos ${group.label}`}>
                  {group.notes.map((note) => (
                    <ThinkingNoteRow
                      key={note.id}
                      note={note}
                      contextOptions={allContextOptions}
                      onSaveEdit={handleThinkingSaveEdit}
                      onArchive={handleThinkingArchive}
                      onTodo={handleThinkingToTodo}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {(showArchive || hasVisibleThinkingArchive) ? (
              <div className="archive-toggle-row">
                <button
                  type="button"
                  className={showArchive ? 'archive-toggle archive-toggle--archive-action archive-toggle--active' : 'archive-toggle archive-toggle--archive-action'}
                  onClick={() => setShowArchive((prev) => !prev)}
                  ref={thinkingArchiveButtonRef}
                  style={thinkingActionButtonWidth ? { width: `${thinkingActionButtonWidth}px` } : undefined}
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
                  <span>{showArchive ? 'Archiv ausblenden' : 'Archiv anzeigen'}</span>
                </button>
              </div>
            ) : null}
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
                {thinkingArchiveWarnings.length > 0 ? (
                  <p className="hint retention-inline-warning">
                    Achtung: {thinkingArchiveWarnings.length} Archiv-Eintrag{thinkingArchiveWarnings.length === 1 ? '' : 'e'} werden innerhalb der nächsten 7 Tage endgültig gelöscht.
                  </p>
                ) : null}
                <div className="archive-danger-row">
                  <button
                    type="button"
                    className="review-btn danger-btn danger-btn--critical"
                    onClick={() => void handleClearThinkingArchive()}
                  >
                    Archiv leeren
                  </button>
                </div>
              </>
            ) : null}
            </>
          ) : null}

          {activeTab === 'TODO' ? (
            <>
            <FlowHero
              title="Deine nächsten Schritte"
              subtitle={reduceMainTabHelpers ? '' : 'Hier behältst du den den Überblick über deine Handlungen.'}
            />
            <div className="todo-filter-row">
              <label className="todo-search-wrap">
                <span className="sr-only">Handlungen durchsuchen</span>
                <svg className="todo-search-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="m20 20-3.6-3.6M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  type="search"
                  className="todo-search-input"
                  ref={todoSearchInputRef}
                  value={todoSearchQuery}
                  onChange={(event) => setTodoSearchQuery(event.target.value)}
                  placeholder="Suchen"
                  aria-label="Handlungen durchsuchen"
                />
                {todoSearchQuery.length > 0 ? (
                  <button
                    type="button"
                    className="todo-search-clear"
                    onClick={() => {
                      setTodoSearchQuery('')
                      todoSearchInputRef.current?.focus()
                    }}
                    aria-label="Suche löschen"
                    title="Suche löschen"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M7 7 17 17M17 7 7 17"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : null}
              </label>
              <label className="context-select-wrap">
                <span className="sr-only">Kontext filtern</span>
                <select
                  className="context-select context-select--filter"
                  value={todoContextFilter}
                  onChange={(event) => setTodoContextFilter(event.target.value as ContextFilter)}
                  aria-label="Kontext filtern"
                  title="Kontext filtern"
                >
                  <option value="">Alle Kontexte</option>
                  <option value="__none">Ohne Kontext</option>
                  {todoContextOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
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
            </div>
            {lastTodoAction && lastTodoAction.scope === 'TODO' ? (
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
            {todoNotes.length === 0 ? (
              <section className="review-empty-cta" aria-label="Machen leer">
                <p className="empty-text">Keine offenen Handlungen.</p>
                <p className="hint">Erfasse zuerst ein Memo in Erfassen und ordne es dann zu Handlungen.</p>
                <div className="review-empty-cta-actions">
                  <button
                    type="button"
                    className="review-btn review-btn--cta"
                    onClick={() => setActiveTab('BRAINDUMP')}
                    ref={todoCtaButtonRef}
                    style={todoActionButtonWidth ? { width: `${todoActionButtonWidth}px` } : undefined}
                  >
                    Gedanken erfassen
                  </button>
                </div>
              </section>
            ) : null}
            {todoNotes.length > 0 && visibleTodoNotes.length === 0 ? (
              <p className="empty-text">
                {todoFiltersSummary}
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
                      contextOptions={allContextOptions}
                      onSaveEdit={handleTodoSaveEdit}
                      onToggleStar={handleTodoToggleStar}
                      onDone={handleTodoDone}
                      onThinking={handleTodoToThinking}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {(showTodoArchive || hasVisibleTodoArchive) ? (
              <div className="archive-toggle-row">
                <button
                  type="button"
                  className={showTodoArchive ? 'archive-toggle archive-toggle--archive-action archive-toggle--active' : 'archive-toggle archive-toggle--archive-action'}
                  onClick={() => setShowTodoArchive((prev) => !prev)}
                  ref={todoArchiveButtonRef}
                  style={todoActionButtonWidth ? { width: `${todoActionButtonWidth}px` } : undefined}
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
                  <span>{showTodoArchive ? 'Archiv ausblenden' : 'Archiv anzeigen'}</span>
                </button>
              </div>
            ) : null}
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
                {todoArchiveWarnings.length > 0 ? (
                  <p className="hint retention-inline-warning">
                    Achtung: {todoArchiveWarnings.length} Archiv-Eintrag{todoArchiveWarnings.length === 1 ? '' : 'e'} werden innerhalb der nächsten 7 Tage endgültig gelöscht.
                  </p>
                ) : null}
                <div className="archive-danger-row">
                  <button
                    type="button"
                    className="review-btn danger-btn danger-btn--critical"
                    onClick={() => void handleClearTodoArchive()}
                  >
                    Archiv leeren
                  </button>
                </div>
              </>
            ) : null}
            </>
          ) : null}

            {info && activeTab !== 'DATA' ? (
              <p className={isInfoFadingOut ? 'hint hint--transient hint--fade-out' : 'hint hint--transient'}>
                {info}
              </p>
            ) : null}
              {error ? <p className="error-text">{error}</p> : null}
          </div>
        </section>
    </AppShell>
  )
}

export function App() {
  const [hasVisited, setHasVisited] = useState(readHasVisitedFlag)

  const handleStart = useCallback(() => {
    persistHasVisitedFlag()
    setHasVisited(true)
  }, [])

  if (!hasVisited) {
    return <LandingScreen onStart={handleStart} />
  }

  return (
    <FooterProvider>
      <AppContent />
    </FooterProvider>
  )
}
