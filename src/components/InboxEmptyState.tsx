const INBOX_EMPTY_COPY = {
  title: 'Noch ist hier nichts.',
  hint: 'Alles beginnt mit einem Gedanken.',
} as const

export function InboxEmptyState() {
  return (
    <section className="inbox-empty-state" aria-label="Inbox Hilfe">
      <p className="inbox-empty-state__title">{INBOX_EMPTY_COPY.title}</p>
      <p className="inbox-empty-state__hint">{INBOX_EMPTY_COPY.hint}</p>
    </section>
  )
}
