import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { getMonthEntryByMonthISO, upsertMonthEntryByMonthISO } from '../lib/db/monthEntries'
import { DEFAULT_MONTH_DRAFT, type MonthEntryDraft, type MonthMode } from '../lib/monthEntry'

const MONTH_MODES: MonthMode[] = ['', 'STABIL', 'ANGESPANNT', 'UEBERLAST', 'KRISE']

function toMonthISO(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function parseMonthISO(monthISO: string) {
  if (!/^\d{4}-\d{2}$/.test(monthISO)) {
    return null
  }

  const [yearText, monthText] = monthISO.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const date = new Date(year, monthIndex, 1)

  if (Number.isNaN(date.getTime()) || toMonthISO(date) !== monthISO) {
    return null
  }

  return date
}

function currentMonthISO() {
  return toMonthISO(new Date())
}

function shiftMonth(monthISO: string, offset: number) {
  const base = parseMonthISO(monthISO) ?? new Date()
  base.setMonth(base.getMonth() + offset)
  base.setDate(1)
  return toMonthISO(base)
}

function cloneDraft(draft: MonthEntryDraft): MonthEntryDraft {
  return {
    dominantMode: draft.dominantMode,
    reflection: draft.reflection,
  }
}

export function MonatPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMonth = searchParams.get('m')
  const parsedInitialMonth = initialMonth ? parseMonthISO(initialMonth) : null
  const [selectedMonthISO, setSelectedMonthISO] = useState(
    parsedInitialMonth ? toMonthISO(parsedInitialMonth) : currentMonthISO(),
  )
  const [draft, setDraft] = useState<MonthEntryDraft>(cloneDraft(DEFAULT_MONTH_DRAFT))
  const [savedDraft, setSavedDraft] = useState<MonthEntryDraft>(cloneDraft(DEFAULT_MONTH_DRAFT))
  const [entryId, setEntryId] = useState<string | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [hasEntry, setHasEntry] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft],
  )

  useEffect(() => {
    setSearchParams({ m: selectedMonthISO }, { replace: true })
  }, [selectedMonthISO, setSearchParams])

  useEffect(() => {
    let cancelled = false

    const loadMonth = async () => {
      try {
        const entry = await getMonthEntryByMonthISO(selectedMonthISO)
        if (cancelled) {
          return
        }

        if (!entry) {
          const emptyDraft = cloneDraft(DEFAULT_MONTH_DRAFT)
          setEntryId(null)
          setCreatedAt(null)
          setHasEntry(false)
          setDraft(emptyDraft)
          setSavedDraft(emptyDraft)
          return
        }

        const loadedDraft: MonthEntryDraft = {
          dominantMode: entry.dominantMode ?? '',
          reflection: entry.reflection,
        }

        setEntryId(entry.id)
        setCreatedAt(entry.createdAt)
        setHasEntry(true)
        setDraft(loadedDraft)
        setSavedDraft(loadedDraft)
      } catch {
        if (!cancelled) {
          setMessage('Fehler beim Laden dieses Monats.')
        }
      }
    }

    void loadMonth()

    return () => {
      cancelled = true
    }
  }, [location.search, selectedMonthISO])

  const saveDraft = useCallback(
    async (nextDraft: MonthEntryDraft) => {
      setIsSaving(true)
      const now = new Date().toISOString()
      const nextId = entryId ?? crypto.randomUUID()
      const nextCreatedAt = createdAt ?? now

      try {
        await upsertMonthEntryByMonthISO({
          id: nextId,
          monthISO: selectedMonthISO,
          dominantMode: nextDraft.dominantMode,
          reflection: nextDraft.reflection,
          createdAt: nextCreatedAt,
        })

        setEntryId(nextId)
        setCreatedAt(nextCreatedAt)
        setHasEntry(true)
        setSavedDraft(cloneDraft(nextDraft))
      } catch {
        setMessage('Speichern fehlgeschlagen.')
      } finally {
        setIsSaving(false)
      }
    },
    [createdAt, entryId, selectedMonthISO],
  )

  useEffect(() => {
    if (!isDirty) {
      return
    }

    const timeout = window.setTimeout(() => {
      void saveDraft(draft)
    }, 500)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [draft, isDirty, saveDraft])

  const handleMonthChange = (value: string) => {
    const parsed = parseMonthISO(value)
    if (!parsed) {
      return
    }
    setMessage('')
    setSelectedMonthISO(toMonthISO(parsed))
  }

  const handleResetMonth = async () => {
    setMessage('')
    const emptyDraft = cloneDraft(DEFAULT_MONTH_DRAFT)
    setDraft(emptyDraft)
    await saveDraft(emptyDraft)
  }

  return (
    <section>
      <h2>Monat</h2>
      <p>Ein ruhiger Blick auf den Monat, ohne Bewertung.</p>
      {!hasEntry ? <p className="mode-distribution">Für diesen Monat gibt es noch keinen Eintrag.</p> : null}

      <div className="week-meta-row">
        <label className="form-field week-picker">
          <span>Monat</span>
          <div className="week-picker-controls">
            <button type="button" aria-label="Vorheriger Monat" onClick={() => setSelectedMonthISO((prev) => shiftMonth(prev, -1))}>
              ←
            </button>
            <input
              type="month"
              value={selectedMonthISO}
              onChange={(event) => handleMonthChange(event.target.value)}
            />
            <button type="button" aria-label="Nächster Monat" onClick={() => setSelectedMonthISO((prev) => shiftMonth(prev, 1))}>
              →
            </button>
          </div>
        </label>

        <div className="save-state" aria-live="polite">
          {isSaving ? 'Speichert...' : isDirty ? 'Ungespeichert' : 'Gespeichert'}
        </div>
      </div>

      <form className="week-form" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="mode-fieldset">
          <legend>Dominante Phase</legend>
          <div className="mode-options">
            {MONTH_MODES.map((mode) => (
              <label key={mode || 'none'} className="mode-option">
                <input
                  type="radio"
                  name="dominantMode"
                  checked={draft.dominantMode === mode}
                  onChange={() => setDraft((prev) => ({ ...prev, dominantMode: mode }))}
                />
                <span>{mode || 'Keine Angabe'}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="form-field">
          <span>Notiz (optional)</span>
          <textarea
            rows={6}
            placeholder="Was war in diesem Monat prägend?"
            value={draft.reflection}
            onChange={(event) => setDraft((prev) => ({ ...prev, reflection: event.target.value }))}
          />
        </label>

        <div className="action-row">
          <button type="button" onClick={() => void handleResetMonth()}>
            Monat leeren
          </button>
        </div>

        {message ? <p className="status-message">{message}</p> : null}
      </form>
    </section>
  )
}
