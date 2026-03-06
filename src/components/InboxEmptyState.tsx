const INBOX_EMPTY_COPY = {
  title: 'Noch ist hier nichts.',
  text: 'Schreibe deinen ersten Gedanken auf.',
  hint: 'Alles beginnt in der Inbox.',
} as const

export function InboxEmptyState() {
  return (
    <section className="inbox-empty-state" aria-label="Inbox Hilfe">
      <p className="inbox-empty-state__title">{INBOX_EMPTY_COPY.title}</p>
      <p className="inbox-empty-state__text">{INBOX_EMPTY_COPY.text}</p>
      <p className="inbox-empty-state__hint">{INBOX_EMPTY_COPY.hint}</p>
    </section>
  )
}
