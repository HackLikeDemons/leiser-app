type AboutScreenProps = {
  onBackToCapture: () => void
}

const ABOUT_COPY = {
  title: 'Leiser',
  intro: 'Leiser hilft dir im Alltag einen freien Kopf zu behalten: Memos festhalten, später in der Inbox entscheiden und in konkrete nächste Schritte übertragen.',
  privacy:
    'Notizinhalte werden auf deinem Gerät gespeichert. Wenn du den Sync aktivierst, werden sie verschlüsselt in deinen Sync-Raum übertragen. Nur Geräte, die mit deinem Sync-Raum verbunden sind, können auf deine Notizinhalte zugreifen.',
  steps: [
    'Erfassen: Memos sofort in die Inbox schreiben.',
    'Inbox: Memos behalten, in eine Handlung überführen oder verwerfen.',
    'Memos und Machen: weiterentwickeln und umsetzen.',
  ],
  footer:
    'Offline-first, ohne Ballast, mit optionalem verschlüsseltem Sync über deine Geräte.',
  tech:
    'Mehr über die technischen Hintergründe findest du auf GitHub:',
  techLinkLabel: 'github.com/HackLikeDemons/leiser-app',
  techLinkHref: 'https://github.com/HackLikeDemons/leiser-app',
  cta: 'Gedanken erfassen',
} as const

export function AboutScreen({ onBackToCapture }: AboutScreenProps) {
  return (
    <section className="about-screen" aria-label="Über Leiser">
      <h2>{ABOUT_COPY.title}</h2>
      <p className="about-screen__intro">{ABOUT_COPY.intro}</p>
      <ol className="about-screen__steps">
        {ABOUT_COPY.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="about-screen__footer">{ABOUT_COPY.footer}</p>
      <p className="about-screen__footer">{ABOUT_COPY.privacy}</p>
      <p className="about-screen__footer">
        {ABOUT_COPY.tech}{' '}
        <a
          className="about-screen__link"
          href={ABOUT_COPY.techLinkHref}
          target="_blank"
          rel="noreferrer"
        >
          {ABOUT_COPY.techLinkLabel}
        </a>
      </p>
      <button type="button" className="review-btn review-btn--cta about-screen__cta" onClick={onBackToCapture}>
        {ABOUT_COPY.cta}
      </button>
    </section>
  )
}
