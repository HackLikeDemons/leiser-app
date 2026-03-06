# Leiser

Leiser ist eine lokale, offline-fähige Gedanken- und Handlungs-App.

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

## Hinweis

Die alte Basis-Spezifikation der früheren Wochen-/Monatsfunktionen liegt in [SPEC.md](SPEC.md). Die aktive Anwendung ist das Notes-/Workflow-Modell.
