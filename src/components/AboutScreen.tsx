type AboutScreenProps = {
  onBackToCapture: () => void
}

const ABOUT_COPY = {
  title: 'Leiser',
  intro: 'hilft dir, deine Gedanken schnell festzuhalten und sie später in Ruhe zu sortieren.',
  privacy:
    'Notizinhalte werden auf deinem Gerät gespeichert. Wenn du den Sync aktivierst werden sie verschlüsselt in deinen Sync-Raum übertragen. Nur Geräte die mit deinem Sync-Raum verbunden sind, könen auf deine Notizinhalte zugreifen.',
  steps: [
    'Sammeln: Gedanken sofort in die Inbox schreiben.',
    'Ordnen: Gedanken behalten, in eine Aufgabe überführen oder verwerfen.',
    'Denken und Machen: weiterdenken und umsetzen.',
  ],
  footer:
    'Die App funktioniert lokal und deine Daten müssen nicht in die Cloud übertragen werden, denn der Sync mit deinen anderen Geräten ist optional.',
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
      <button type="button" className="review-btn review-btn--cta about-screen__cta" onClick={onBackToCapture}>
        {ABOUT_COPY.cta}
      </button>
    </section>
  )
}
