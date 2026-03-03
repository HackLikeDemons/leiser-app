function getIsoWeekLabel() {
  const now = new Date()
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

  return `KW ${String(week).padStart(2, '0')}`
}

export function WochenblattFormPlaceholder() {
  const currentWeek = getIsoWeekLabel()

  return (
    <form className="placeholder-form" aria-label="Wochenblatt Platzhalterformular">
      <label className="form-field">
        <span>Titel</span>
        <input type="text" placeholder="" aria-label="Titel" />
      </label>

      <label className="form-field">
        <span>Woche</span>
        <input type="text" defaultValue={currentWeek} aria-label="Woche" />
      </label>

      <label className="form-field">
        <span>Notizen</span>
        <textarea rows={5} placeholder="" aria-label="Notizen" />
      </label>
    </form>
  )
}
