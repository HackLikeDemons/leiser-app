import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearAllMonthEntries } from '../lib/db/monthEntries'
import { clearAllWeekEntries } from '../lib/db/weekEntries'
import { seedDemoData } from '../lib/demo/seedDemoData'

export function DataControls() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const handleSeedDemo = async () => {
    setIsBusy(true)
    setStatus('')
    try {
      await seedDemoData()
      setStatus('Demodaten geladen')
      navigate(`/history?refresh=${Date.now()}`)
    } catch {
      setStatus('Demodaten konnten nicht geladen werden')
    } finally {
      setIsBusy(false)
    }
  }

  const handleClearAll = async () => {
    const confirmed = window.confirm('Alle lokalen Daten wirklich löschen?')
    if (!confirmed) {
      return
    }

    setIsBusy(true)
    setStatus('')
    try {
      await Promise.all([clearAllWeekEntries(), clearAllMonthEntries()])
      setStatus('Alle lokalen Daten gelöscht')
      navigate(`/history?refresh=${Date.now()}`)
    } catch {
      setStatus('Löschen fehlgeschlagen')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="data-controls" aria-label="Daten">
      <h2>Daten</h2>
      <div className="data-controls-actions">
        <button type="button" onClick={() => void handleSeedDemo()} disabled={isBusy}>
          Demodaten laden
        </button>
        <button type="button" onClick={() => void handleClearAll()} disabled={isBusy}>
          Alle Daten löschen
        </button>
      </div>
      {status ? <p className="data-controls-status">{status}</p> : null}
    </section>
  )
}
