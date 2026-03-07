type AboutScreenProps = {
  onBackToCapture: () => void
}

const ABOUT_COPY = {
  title: 'Leiser',
  intro: 'hilft dir, deine Gedanken schnell festzuhalten und sie später in Ruhe zu sortieren.',
  privacy:
    'Notiztexte werden auf deinem Gerät verschlüsselt gespeichert und auch verschlüsselt synchronisiert. Metadaten für Sortierung und Sync bleiben technisch bedingt im Klartext.',
  steps: [
    'Sammeln: Gedanken sofort in die Inbox schreiben.',
    'Ordnen: Gedanken behalten, in eine Aufgabe überführen oder verwerfen.',
    'Denken und Machen: weiterdenken und umsetzen.',
  ],
  footer:
    'Alles funktioniert lokal und offline. Sync ist optional. Wenn ein Gerät selbst kompromittiert ist, kann laufender Klartext trotzdem ausgelesen werden.',
  cta: 'Gedanken erfassen',
} as const

export function AboutScreen({ onBackToCapture }: AboutScreenProps) {
  return (
    <section className="about-screen" aria-label="Über Leiser">
      <h2>{ABOUT_COPY.title}</h2>
      <p className="about-screen__intro">{ABOUT_COPY.intro}</p>
      <p className="about-screen__footer">{ABOUT_COPY.privacy}</p>
      <ol className="about-screen__steps">
        {ABOUT_COPY.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="about-screen__footer">{ABOUT_COPY.footer}</p>
      <button type="button" className="about-screen__cta" onClick={onBackToCapture}>
        {ABOUT_COPY.cta}
      </button>
    </section>
  )
}
