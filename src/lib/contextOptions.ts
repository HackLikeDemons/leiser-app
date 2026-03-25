import { readStorageItem, writeStorageItem } from './storage'
import { normalizeContextTag } from './types'
import type { ContextTag } from './types'

const CONTEXT_OPTIONS_STORAGE_KEY = 'leiser:context-options-v1'
const DEFAULT_CONTEXT_OPTIONS_UPDATED_AT = new Date(0).toISOString()

export type ContextOption = {
  value: ContextTag
  label: string
}

export type ContextOptionsState = {
  updatedAt: string
  options: ContextOption[]
}

export const DEFAULT_CONTEXT_OPTIONS: ContextOption[] = [
  { value: 'arbeit', label: 'Arbeit' },
  { value: 'familie', label: 'Familie' },
  { value: 'finanzen', label: 'Finanzen' },
  { value: 'freunde', label: 'Freunde' },
  { value: 'gesundheit', label: 'Gesundheit' },
  { value: 'haushalt', label: 'Haushalt' },
  { value: 'privat', label: 'Privat' },
  { value: 'projekt', label: 'Projekt' },
]

function capitalizeFirstCharacter(value: string) {
  if (!value) {
    return value
  }
  return value.charAt(0).toLocaleUpperCase('de-DE') + value.slice(1)
}

export function normalizeContextLabel(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) {
    return undefined
  }
  return compact.slice(0, 28)
}

export function sanitizeContextOptions(raw: unknown): ContextOption[] {
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
  return Array.from(deduped.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de-DE'))
}

function normalizeUpdatedAt(value: unknown, fallback = DEFAULT_CONTEXT_OPTIONS_UPDATED_AT) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback
}

function normalizeContextOptionsState(raw: unknown, fallbackUpdatedAt: string): ContextOptionsState {
  if (Array.isArray(raw)) {
    return {
      updatedAt: normalizeUpdatedAt(fallbackUpdatedAt, new Date().toISOString()),
      options: sanitizeContextOptions(raw),
    }
  }

  if (!raw || typeof raw !== 'object') {
    return {
      updatedAt: DEFAULT_CONTEXT_OPTIONS_UPDATED_AT,
      options: [...DEFAULT_CONTEXT_OPTIONS],
    }
  }

  const candidate = raw as Partial<ContextOptionsState>
  return {
    updatedAt: normalizeUpdatedAt(candidate.updatedAt, fallbackUpdatedAt),
    options: sanitizeContextOptions(candidate.options),
  }
}

function fingerprintContextOptionsState(state: ContextOptionsState) {
  return JSON.stringify({
    updatedAt: normalizeUpdatedAt(state.updatedAt),
    options: sanitizeContextOptions(state.options),
  })
}

function compareContextOptionsStates(a: ContextOptionsState | null, b: ContextOptionsState | null) {
  if (a && !b) {
    return 1
  }
  if (!a && b) {
    return -1
  }
  if (!a || !b) {
    return 0
  }

  const updatedAtDiff = Date.parse(normalizeUpdatedAt(a.updatedAt)) - Date.parse(normalizeUpdatedAt(b.updatedAt))
  if (updatedAtDiff !== 0) {
    return updatedAtDiff
  }

  return fingerprintContextOptionsState(a).localeCompare(fingerprintContextOptionsState(b))
}

export function readStoredContextOptionsState(): ContextOptionsState {
  const raw = readStorageItem(CONTEXT_OPTIONS_STORAGE_KEY)
  if (!raw) {
    return {
      updatedAt: DEFAULT_CONTEXT_OPTIONS_UPDATED_AT,
      options: [...DEFAULT_CONTEXT_OPTIONS],
    }
  }

  try {
    return normalizeContextOptionsState(JSON.parse(raw), new Date().toISOString())
  } catch {
    return {
      updatedAt: DEFAULT_CONTEXT_OPTIONS_UPDATED_AT,
      options: [...DEFAULT_CONTEXT_OPTIONS],
    }
  }
}

export function readStoredContextOptions() {
  return readStoredContextOptionsState().options
}

export function writeStoredContextOptionsState(state: ContextOptionsState) {
  const normalized = normalizeContextOptionsState(state, state.updatedAt)
  writeStorageItem(CONTEXT_OPTIONS_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function persistContextOptions(options: ContextOption[]) {
  const nextState = writeStoredContextOptionsState({
    updatedAt: new Date().toISOString(),
    options,
  })

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('leiser:local-change', {
        detail: { kind: 'context-options' },
      }),
    )
  }

  return nextState
}

export function areContextOptionsStatesEqual(a: ContextOptionsState | null, b: ContextOptionsState | null) {
  if (!a && !b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  return fingerprintContextOptionsState(a) === fingerprintContextOptionsState(b)
}

export function pickLatestContextOptionsState(a: ContextOptionsState | null, b: ContextOptionsState | null) {
  return compareContextOptionsStates(a, b) >= 0 ? a : b
}
