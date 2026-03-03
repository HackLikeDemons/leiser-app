import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getSystemMapEntryByPeriodISO,
  listSystemMapEntries,
  upsertSystemMapEntryByPeriodISO,
} from '../lib/db/systemMapEntries'
import {
  DEFAULT_SYSTEM_MAP_DRAFT,
  DOMAINS,
  type Domain,
  type SystemMapDraft,
  type SystemMapEntry,
  type SystemMapLink,
} from '../lib/systemMapEntry'

const MAX_BULLETS_PER_DOMAIN = 5
const MAX_LINKS = 6
const MAX_LINK_NOTE_LENGTH = 120
const MAX_LEVERAGE_LENGTH = 240

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

function currentPeriodISO() {
  return toMonthISO(new Date())
}

function shiftMonth(periodISO: string, offset: number) {
  const date = parseMonthISO(periodISO) ?? new Date()
  date.setMonth(date.getMonth() + offset)
  date.setDate(1)
  return toMonthISO(date)
}

function buildMonthOptions(periodISO: string, total = 12) {
  const options: string[] = []
  for (let i = 0; i < total; i += 1) {
    options.push(shiftMonth(periodISO, -i))
  }
  return options
}

function cloneDraft(draft: SystemMapDraft): SystemMapDraft {
  return {
    domains: {
      HEALTH: { bullets: [...draft.domains.HEALTH.bullets] },
      WORK: { bullets: [...draft.domains.WORK.bullets] },
      LOVE: { bullets: [...draft.domains.LOVE.bullets] },
      PLAY: { bullets: [...draft.domains.PLAY.bullets] },
    },
    links: draft.links.map((link) => ({ ...link })),
    leverage: draft.leverage,
  }
}

function linesToBullets(input: string) {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_BULLETS_PER_DOMAIN)
}

function bulletsToLines(bullets: string[]) {
  return bullets.join('\n')
}

function normalizeLinkNote(note: string) {
  return note.trim().slice(0, MAX_LINK_NOTE_LENGTH)
}

function isDuplicateLink(links: SystemMapLink[], nextFrom: Domain, nextTo: Domain) {
  return links.some((link) => link.from === nextFrom && link.to === nextTo)
}

export function SystemPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialPeriod = searchParams.get('p')
  const parsedInitialPeriod = initialPeriod ? parseMonthISO(initialPeriod) : null

  const [selectedPeriodISO, setSelectedPeriodISO] = useState(
    parsedInitialPeriod ? toMonthISO(parsedInitialPeriod) : currentPeriodISO(),
  )
  const [draft, setDraft] = useState<SystemMapDraft>(cloneDraft(DEFAULT_SYSTEM_MAP_DRAFT))
  const [savedDraft, setSavedDraft] = useState<SystemMapDraft>(cloneDraft(DEFAULT_SYSTEM_MAP_DRAFT))
  const [entryId, setEntryId] = useState<string | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [recentEntries, setRecentEntries] = useState<SystemMapEntry[]>([])
  const [linkFrom, setLinkFrom] = useState<Domain>('HEALTH')
  const [linkTo, setLinkTo] = useState<Domain>('WORK')
  const [linkNote, setLinkNote] = useState('')

  const monthOptions = useMemo(() => buildMonthOptions(selectedPeriodISO, 12), [selectedPeriodISO])
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft],
  )

  useEffect(() => {
    setSearchParams({ p: selectedPeriodISO }, { replace: true })
  }, [selectedPeriodISO, setSearchParams])

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
      try {
        const [entry, recent] = await Promise.all([
          getSystemMapEntryByPeriodISO(selectedPeriodISO),
          listSystemMapEntries(6),
        ])

        if (cancelled) {
          return
        }

        setRecentEntries(recent)

        if (!entry) {
          const empty = cloneDraft(DEFAULT_SYSTEM_MAP_DRAFT)
          setEntryId(null)
          setCreatedAt(null)
          setDraft(empty)
          setSavedDraft(empty)
          return
        }

        const loadedDraft: SystemMapDraft = {
          domains: {
            HEALTH: { bullets: [...entry.domains.HEALTH.bullets].slice(0, MAX_BULLETS_PER_DOMAIN) },
            WORK: { bullets: [...entry.domains.WORK.bullets].slice(0, MAX_BULLETS_PER_DOMAIN) },
            LOVE: { bullets: [...entry.domains.LOVE.bullets].slice(0, MAX_BULLETS_PER_DOMAIN) },
            PLAY: { bullets: [...entry.domains.PLAY.bullets].slice(0, MAX_BULLETS_PER_DOMAIN) },
          },
          links: entry.links.slice(0, MAX_LINKS),
          leverage: entry.leverage ?? '',
        }

        setEntryId(entry.id)
        setCreatedAt(entry.createdAt)
        setDraft(loadedDraft)
        setSavedDraft(loadedDraft)
      } catch {
        if (!cancelled) {
          setMessage('Systemblick konnte nicht geladen werden.')
        }
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [selectedPeriodISO])

  const saveDraft = useCallback(
    async (nextDraft: SystemMapDraft) => {
      setIsSaving(true)
      const now = new Date().toISOString()
      const nextId = entryId ?? crypto.randomUUID()
      const nextCreatedAt = createdAt ?? now

      try {
        await upsertSystemMapEntryByPeriodISO({
          id: nextId,
          periodISO: selectedPeriodISO,
          domains: {
            HEALTH: { bullets: nextDraft.domains.HEALTH.bullets.slice(0, MAX_BULLETS_PER_DOMAIN) },
            WORK: { bullets: nextDraft.domains.WORK.bullets.slice(0, MAX_BULLETS_PER_DOMAIN) },
            LOVE: { bullets: nextDraft.domains.LOVE.bullets.slice(0, MAX_BULLETS_PER_DOMAIN) },
            PLAY: { bullets: nextDraft.domains.PLAY.bullets.slice(0, MAX_BULLETS_PER_DOMAIN) },
          },
          links: nextDraft.links.slice(0, MAX_LINKS),
          leverage: nextDraft.leverage.slice(0, MAX_LEVERAGE_LENGTH),
          createdAt: nextCreatedAt,
        })

        const cleanDraft = cloneDraft({
          ...nextDraft,
          domains: {
            HEALTH: { bullets: nextDraft.domains.HEALTH.bullets.slice(0, MAX_BULLETS_PER_DOMAIN) },
            WORK: { bullets: nextDraft.domains.WORK.bullets.slice(0, MAX_BULLETS_PER_DOMAIN) },
            LOVE: { bullets: nextDraft.domains.LOVE.bullets.slice(0, MAX_BULLETS_PER_DOMAIN) },
            PLAY: { bullets: nextDraft.domains.PLAY.bullets.slice(0, MAX_BULLETS_PER_DOMAIN) },
          },
          links: nextDraft.links.slice(0, MAX_LINKS),
          leverage: nextDraft.leverage.slice(0, MAX_LEVERAGE_LENGTH),
        })

        setEntryId(nextId)
        setCreatedAt(nextCreatedAt)
        setSavedDraft(cleanDraft)

        const recent = await listSystemMapEntries(6)
        setRecentEntries(recent)
      } catch {
        setMessage('Speichern fehlgeschlagen.')
      } finally {
        setIsSaving(false)
      }
    },
    [createdAt, entryId, selectedPeriodISO],
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

  const setDomainLines = (domain: Domain, input: string) => {
    setDraft((prev) => ({
      ...prev,
      domains: {
        ...prev.domains,
        [domain]: { bullets: linesToBullets(input) },
      },
    }))
  }

  const addLink = () => {
    setMessage('')
    if (draft.links.length >= MAX_LINKS) {
      setMessage('Maximal 6 Wechselwirkungen.')
      return
    }

    if (linkFrom === linkTo) {
      setMessage('Von und Auf müssen unterschiedlich sein.')
      return
    }

    if (isDuplicateLink(draft.links, linkFrom, linkTo)) {
      setMessage('Diese Wechselwirkung existiert bereits.')
      return
    }

    const note = normalizeLinkNote(linkNote)
    setDraft((prev) => ({
      ...prev,
      links: [...prev.links, note ? { from: linkFrom, to: linkTo, note } : { from: linkFrom, to: linkTo }],
    }))
    setLinkNote('')
  }

  const removeLink = (index: number) => {
    setMessage('')
    setDraft((prev) => ({
      ...prev,
      links: prev.links.filter((_, idx) => idx !== index),
    }))
  }

  const handleReset = async () => {
    setMessage('')
    const empty = cloneDraft(DEFAULT_SYSTEM_MAP_DRAFT)
    setDraft(empty)
    await saveDraft(empty)
  }

  return (
    <section>
      <h2>Systemblick</h2>
      <p>Ein bewusster Snapshot der Wechselwirkungen.</p>

      <div className="week-meta-row">
        <label className="form-field week-picker">
          <span>Zeitraum (Monat)</span>
          <div className="week-picker-controls">
            <button type="button" aria-label="Vorheriger Monat" onClick={() => setSelectedPeriodISO((prev) => shiftMonth(prev, -1))}>
              ←
            </button>
            <select value={selectedPeriodISO} onChange={(event) => setSelectedPeriodISO(event.target.value)}>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
            <button type="button" aria-label="Nächster Monat" onClick={() => setSelectedPeriodISO((prev) => shiftMonth(prev, 1))}>
              →
            </button>
          </div>
        </label>

        <div className="save-state" aria-live="polite">
          {isSaving ? 'Speichert...' : isDirty ? 'Ungespeichert' : 'Gespeichert'}
        </div>
      </div>

      <form className="week-form" onSubmit={(event) => event.preventDefault()}>
        {DOMAINS.map((domain) => (
          <label className="form-field" key={domain}>
            <span>{domain}</span>
            <textarea
              rows={5}
              placeholder="Kurze Punkte, eine Zeile pro Gedanke"
              value={bulletsToLines(draft.domains[domain].bullets)}
              onChange={(event) => setDomainLines(domain, event.target.value)}
            />
            <small className="hint">Maximal 5 Punkte</small>
          </label>
        ))}

        <fieldset className="mode-fieldset">
          <legend>Wirkt auf</legend>
          <div className="system-link-builder">
            <select value={linkFrom} onChange={(event) => setLinkFrom(event.target.value as Domain)}>
              {DOMAINS.map((domain) => (
                <option key={`from-${domain}`} value={domain}>
                  Von: {domain}
                </option>
              ))}
            </select>
            <select value={linkTo} onChange={(event) => setLinkTo(event.target.value as Domain)}>
              {DOMAINS.map((domain) => (
                <option key={`to-${domain}`} value={domain}>
                  Auf: {domain}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Notiz (optional)"
              value={linkNote}
              onChange={(event) => setLinkNote(event.target.value.slice(0, MAX_LINK_NOTE_LENGTH))}
            />
            <button type="button" onClick={addLink}>
              Link hinzufügen
            </button>
          </div>

          {draft.links.length > 0 ? (
            <ul className="system-links-list">
              {draft.links.map((link, index) => (
                <li key={`${link.from}-${link.to}-${index}`}>
                  <span>{link.from} → {link.to}{link.note ? `: ${link.note}` : ''}</span>
                  <button type="button" onClick={() => removeLink(index)}>
                    Entfernen
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Noch keine Wechselwirkungen eingetragen.</p>
          )}
        </fieldset>

        <label className="form-field">
          <span>Wenn du nur eine Sache drehen könntest (optional)</span>
          <textarea
            rows={3}
            value={draft.leverage}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, leverage: event.target.value.slice(0, MAX_LEVERAGE_LENGTH) }))
            }
          />
          <small className="hint">Maximal {MAX_LEVERAGE_LENGTH} Zeichen</small>
        </label>

        <div className="action-row">
          <button type="button" onClick={() => void handleReset()}>
            Leeren
          </button>
        </div>

        {message ? <p className="status-message">{message}</p> : null}
      </form>

      <h3 className="rhythm-heading">Letzte 6 Systemblicke</h3>
      {recentEntries.length > 0 ? (
        <div className="history-table">
          {recentEntries.map((entry) => {
            const preview = entry.leverage || entry.domains.WORK.bullets[0] || 'Ohne Vorschau'
            return (
              <button
                key={entry.id}
                type="button"
                className="system-recent-item"
                onClick={() => setSelectedPeriodISO(entry.periodISO)}
              >
                <span className="history-cell">{entry.periodISO}</span>
                <span className="history-cell">{preview}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="hint">Noch keine Systemblicke vorhanden.</p>
      )}
    </section>
  )
}
