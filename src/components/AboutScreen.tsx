type AboutScreenProps = {
  onBackToCapture: () => void
}

const ABOUT_COPY = {
  title: 'Leiser',
  intro: 'hilft dir, deine Gedanken schnell festzuhalten und sie später in Ruhe zu sortieren.',
  privacy: 'Deine Gedanken werden lokal auf deinem Gerät gespeichert. Wenn jemand Zugriff auf dein Gerät oder Browser-Profil hat, kann er sie einsehen.',
  steps: [
    'Erfassen: Gedanken sofort in die Inbox schreiben.',
    'Sortieren: Gedanken behalten, in eine Aufgabe überführen oder verwerfen.',
    'Reflektieren und Handeln: weiterdenken und umsetzen.',
  ],
  footer: 'Alles funktioniert lokal und offline. Sync ist optional.',
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
