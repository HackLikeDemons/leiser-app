export function FlowHero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section className="braindump-hero flow-hero" aria-label={title}>
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
    </section>
  )
}
