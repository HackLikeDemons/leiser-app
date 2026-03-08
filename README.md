# Leiser

Leiser hilft dir im Alltag einen freien Kopf zu behalten: Gedanken festhalten, später ordnen und in konkrete nächste Schritte übertragen.

Offline-first, ohne Ballast, mit optionalem verschlüsseltem Sync über deine Geräte.

App ausprobieren: [leiser.app](https://leiser.app)

- Offline-first
- keine Tracker
- Notizen lokal in IndexedDB
- optionaler Geräte-Sync über Supabase

## Schnellstart

```bash
npm install
npm run dev
```

Weitere Skripte:

```bash
npm run lint
npm run build
npm run preview
```

## Aktueller Produktfluss

- `Erfassen`: Gedanken schnell notieren
- `Sortieren`: Inbox entscheiden (weiterdenken, umsetzen, verwerfen)
- `Reflektieren`: offene Gedanken vertiefen
- `Handeln`: nächste Schritte abarbeiten
- Datenbereich über `...` im Header öffnen

## Dokumentation

- [Dokumentationsindex](docs/README.md)
- [Produktüberblick](docs/overview.md)
- [Flows und Tabs](docs/flows.md)
- [Tastenkürzel](docs/shortcuts.md)
- [Datenmodell und IndexedDB](docs/data-model.md)
- [Backup und Import](docs/backup-import.md)
- [Optionaler Supabase Sync](docs/sync.md)
- [Sync E2E Matrix](docs/sync-e2e-matrix.md)
- [Sync Contract](SYNC_CONTRACT.md)
- [Entwicklung](docs/development.md)
- [Deploy auf Netlify](docs/deploy-netlify.md)
- [Test-Checklisten](docs/testing.md)

## Technischer Scope

- Single-View React App ohne Router
- kein Demo-Seed-Code im Produktpfad
- Suche und Filter laufen ohne externe Fuzzy-Search-Abhängigkeit
