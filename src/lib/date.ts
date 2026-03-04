function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function getLocalDayISO(date = new Date()): string {
  const normalized = new Date(date)
  normalized.setHours(12, 0, 0, 0)

  const year = normalized.getFullYear()
  const month = pad(normalized.getMonth() + 1)
  const day = pad(normalized.getDate())

  return `${year}-${month}-${day}`
}
