import type { MouseEventHandler } from 'react'

type LandingScreenProps = {
  onStart: MouseEventHandler<HTMLButtonElement>
}

const LANDING_COPY = {
  title: 'Leiser',
  lead: 'Ein ruhiger Ort für deine Gedanken.',
  points: ['Gedanken sofort notieren.', 'Später sortieren.', 'Kopf frei behalten.'],
  cta: 'Starten',
} as const

export function LandingScreen({ onStart }: LandingScreenProps) {
  return (
    <main className="landing-screen" aria-label="Willkommen bei Leiser">
      <section className="landing-screen__card">
        <h1 className="landing-screen__title">{LANDING_COPY.title}</h1>
        <p className="landing-screen__lead">{LANDING_COPY.lead}</p>
        <ul className="landing-screen__list" aria-label="Leiser in drei Schritten">
          {LANDING_COPY.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <button type="button" className="landing-screen__cta" onClick={onStart}>
          {LANDING_COPY.cta}
        </button>
      </section>
    </main>
  )
}
