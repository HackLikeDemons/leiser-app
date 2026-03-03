import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { deleteWeekEntry, getWeekEntryByWeekStart, upsertWeekEntry } from '../lib/db/weekEntries'
import { DEFAULT_WEEK_DRAFT, type WeekEntryDraft, type WeekMode } from '../lib/weekEntry'

const PRIORITY_SOFT_LIMIT = 120
const TEXTAREA_SOFT_LIMIT = 1000
const MODES: WeekMode[] = ['STABIL', 'ANGESPANNT', 'UEBERLAST', 'KRISE']

function toISODate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseISODateSafe(isoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null
  }

  const [yearText, monthText, dayText] = isoDate.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(year, month - 1, day)

  if (Number.isNaN(date.getTime()) || toISODate(date) !== isoDate) {
    return null
  }

  return date
}

function getMondayISO(date: Date) {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  const dayIndex = (normalized.getDay() + 6) % 7
  normalized.setDate(normalized.getDate() - dayIndex)
  return toISODate(normalized)
}

function currentWeekMondayISO() {
  return getMondayISO(new Date())
}

function shiftWeek(weekStartISO: string, offsetWeeks: number) {
  const date = parseISODateSafe(weekStartISO) ?? new Date()
  date.setDate(date.getDate() + offsetWeeks * 7)
  return toISODate(date)
}

function asTuple(values: string[]): [string, string, string] {
  return [values[0] ?? '', values[1] ?? '', values[2] ?? '']
}

function cloneDraft(draft: WeekEntryDraft): WeekEntryDraft {
  return {
    mode: draft.mode,
    priorities: [...draft.priorities] as [string, string, string],
    bottleneck: draft.bottleneck,
    intentionallyNotDoing: draft.intentionallyNotDoing,
  }
}

export function WochenblattPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialWeek = searchParams.get('week')
  const parsedInitialWeek = initialWeek ? parseISODateSafe(initialWeek) : null
  const [selectedWeekISO, setSelectedWeekISO] = useState(
    parsedInitialWeek ? getMondayISO(parsedInitialWeek) : currentWeekMondayISO(),
  )
  const [draft, setDraft] = useState<WeekEntryDraft>(cloneDraft(DEFAULT_WEEK_DRAFT))
  const [savedDraft, setSavedDraft] = useState<WeekEntryDraft>(cloneDraft(DEFAULT_WEEK_DRAFT))
  const [entryId, setEntryId] = useState<string | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string>('')

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft],
  )

  useEffect(() => {
    setSearchParams({ week: selectedWeekISO }, { replace: true })
  }, [selectedWeekISO, setSearchParams])

  useEffect(() => {
    let cancelled = false

    const loadWeek = async () => {
      try {
        const entry = await getWeekEntryByWeekStart(selectedWeekISO)
        if (cancelled) {
          return
        }

        if (!entry) {
          const emptyDraft = cloneDraft(DEFAULT_WEEK_DRAFT)
          setEntryId(null)
          setCreatedAt(null)
          setDraft(emptyDraft)
          setSavedDraft(emptyDraft)
          return
        }

        const loadedDraft: WeekEntryDraft = {
          mode: entry.mode,
          priorities: asTuple(entry.priorities),
          bottleneck: entry.bottleneck,
          intentionallyNotDoing: entry.intentionallyNotDoing,
        }

        setEntryId(entry.id)
        setCreatedAt(entry.createdAt)
        setDraft(loadedDraft)
        setSavedDraft(loadedDraft)
      } catch {
        if (!cancelled) {
          setMessage('Fehler beim Laden dieser Woche.')
        }
      }
    }

    void loadWeek()

    return () => {
      cancelled = true
    }
  }, [selectedWeekISO])

  const saveDraft = useCallback(
    async (nextDraft: WeekEntryDraft, options?: { forceNewId?: boolean }) => {
      setIsSaving(true)

      const now = new Date().toISOString()
      let nextId = entryId ?? crypto.randomUUID()
      let nextCreatedAt = createdAt ?? now

      try {
        if (options?.forceNewId) {
          if (entryId) {
            await deleteWeekEntry(entryId)
          }
          nextId = crypto.randomUUID()
          nextCreatedAt = now
        }

        await upsertWeekEntry({
          id: nextId,
          weekStartISO: selectedWeekISO,
          mode: nextDraft.mode,
          priorities: nextDraft.priorities,
          bottleneck: nextDraft.bottleneck,
          intentionallyNotDoing: nextDraft.intentionallyNotDoing,
          createdAt: nextCreatedAt,
          updatedAt: now,
        })

        setEntryId(nextId)
        setCreatedAt(nextCreatedAt)
        setSavedDraft(cloneDraft(nextDraft))
      } catch {
        setMessage('Speichern fehlgeschlagen.')
      } finally {
        setIsSaving(false)
      }
    },
    [createdAt, entryId, selectedWeekISO],
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

  const updatePriority = (index: number, value: string) => {
    setDraft((prev) => {
      const priorities = [...prev.priorities]
      priorities[index] = value
      return {
        ...prev,
        priorities: asTuple(priorities),
      }
    })
  }

  const handleWeekChange = (value: string) => {
    const parsed = parseISODateSafe(value)
    if (!parsed) {
      return
    }
    setMessage('')
    setSelectedWeekISO(getMondayISO(parsed))
  }

  const handleSaveClick = () => {
    setMessage('')
    void saveDraft(draft)
  }

  const handleCopyLastWeek = async () => {
    setMessage('')
    const previousWeekISO = shiftWeek(selectedWeekISO, -1)
    const previousEntry = await getWeekEntryByWeekStart(previousWeekISO)

    if (!previousEntry) {
      setMessage('Für die Vorwoche gibt es keinen Eintrag.')
      return
    }

    const copiedDraft: WeekEntryDraft = {
      mode: previousEntry.mode,
      priorities: asTuple(previousEntry.priorities),
      bottleneck: previousEntry.bottleneck,
      intentionallyNotDoing: previousEntry.intentionallyNotDoing,
    }

    setDraft(copiedDraft)
    await saveDraft(copiedDraft, { forceNewId: true })
  }

  const handleResetWeek = async () => {
    setMessage('')
    const emptyDraft = cloneDraft(DEFAULT_WEEK_DRAFT)
    setDraft(emptyDraft)
    await saveDraft(emptyDraft)
  }

  return (
    <section>
      <h2>Wochenblatt</h2>

      <div className="week-meta-row">
        <label className="form-field week-picker">
          <span>Woche (Montag)</span>
          <input
            type="date"
            value={selectedWeekISO}
            onChange={(event) => handleWeekChange(event.target.value)}
          />
        </label>

        <div className="save-state" aria-live="polite">
          {isSaving ? 'Speichert...' : isDirty ? 'Ungespeicherte Änderungen' : 'Gespeichert'}
        </div>
      </div>

      <form className="week-form" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="mode-fieldset">
          <legend>Modus</legend>
          <div className="mode-options">
            {MODES.map((mode) => (
              <label key={mode} className="mode-option">
                <input
                  type="radio"
                  name="mode"
                  checked={draft.mode === mode}
                  onChange={() => setDraft((prev) => ({ ...prev, mode }))}
                />
                <span>{mode}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-field">
          <span>Priorität 1</span>
          <input
            type="text"
            value={draft.priorities[0]}
            onChange={(event) => updatePriority(0, event.target.value)}
          />
          <small className={draft.priorities[0].length > PRIORITY_SOFT_LIMIT ? 'hint warning' : 'hint'}>
            Soft Limit: {PRIORITY_SOFT_LIMIT} Zeichen ({draft.priorities[0].length})
          </small>
        </div>

        <div className="form-field">
          <span>Priorität 2</span>
          <input
            type="text"
            value={draft.priorities[1]}
            onChange={(event) => updatePriority(1, event.target.value)}
          />
          <small className={draft.priorities[1].length > PRIORITY_SOFT_LIMIT ? 'hint warning' : 'hint'}>
            Soft Limit: {PRIORITY_SOFT_LIMIT} Zeichen ({draft.priorities[1].length})
          </small>
        </div>

        <div className="form-field">
          <span>Priorität 3</span>
          <input
            type="text"
            value={draft.priorities[2]}
            onChange={(event) => updatePriority(2, event.target.value)}
          />
          <small className={draft.priorities[2].length > PRIORITY_SOFT_LIMIT ? 'hint warning' : 'hint'}>
            Soft Limit: {PRIORITY_SOFT_LIMIT} Zeichen ({draft.priorities[2].length})
          </small>
        </div>

        <label className="form-field">
          <span>Wo wird es eng?</span>
          <textarea
            rows={5}
            value={draft.bottleneck}
            onChange={(event) => setDraft((prev) => ({ ...prev, bottleneck: event.target.value }))}
          />
          <small className={draft.bottleneck.length > TEXTAREA_SOFT_LIMIT ? 'hint warning' : 'hint'}>
            Soft Limit: {TEXTAREA_SOFT_LIMIT} Zeichen ({draft.bottleneck.length})
          </small>
        </label>

        <label className="form-field">
          <span>Diese Woche mache ich bewusst nicht</span>
          <textarea
            rows={5}
            value={draft.intentionallyNotDoing}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, intentionallyNotDoing: event.target.value }))
            }
          />
          <small
            className={
              draft.intentionallyNotDoing.length > TEXTAREA_SOFT_LIMIT ? 'hint warning' : 'hint'
            }
          >
            Soft Limit: {TEXTAREA_SOFT_LIMIT} Zeichen ({draft.intentionallyNotDoing.length})
          </small>
        </label>

        <div className="action-row">
          <button type="button" onClick={handleSaveClick}>
            Speichern
          </button>
          <button type="button" onClick={() => void handleCopyLastWeek()}>
            Letzte Woche kopieren
          </button>
          <button type="button" onClick={() => void handleResetWeek()}>
            Neue Woche leeren
          </button>
        </div>

        {message ? <p className="status-message">{message}</p> : null}
      </form>
    </section>
  )
}
