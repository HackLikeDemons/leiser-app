# Leiser

Leiser ist ein lokales, offline-fähiges Gedanken-Tool mit Fokus auf schnellen Capture-Flow.

- Keine Cloud
- Kein Backend für Notizen
- Keine Tracker
- Daten bleiben lokal im Browser (IndexedDB)

## Schnellstart

```bash
npm install
npm run dev
```

## Dokumentation

- [Dokumentationsindex](docs/README.md)

### Einstieg
- [Produktüberblick](docs/overview.md)
- [Flows und Tabs](docs/flows.md)
- [Tastenkürzel](docs/shortcuts.md)

### Daten und Sync
- [Datenmodell und IndexedDB](docs/data-model.md)
- [Backup/Import](docs/backup-import.md)
- [Supabase Sync (optional)](docs/sync.md)

### Betrieb
- [Entwicklung](docs/development.md)
- [Deploy auf Netlify](docs/deploy-netlify.md)
- [Test-Checklisten](docs/testing.md)

## Kern-Features (kurz)

- Braindump mit schnellem Capture (`Enter` speichern, `Shift+Enter` Zeile)
- Review mit Auto-Layout (`Single` bei wenigen, `Liste` bei vielen offenen Einträgen)
- Gedanken (`PROCESS`) inkl. eigenem Archiv
- To-Do (`TODO`) mit Tagesgruppen, Stern-Priorisierung und separatem To-Do-Archiv
- Volltextsuche
- Backup Export/Import
- Optionaler Geräte-Sync via Supabase

## Hinweise

- Die aktuelle Basis-Spezifikation der früheren Wochen-/Monatsfunktionen liegt in [SPEC.md](SPEC.md).
- Die aktive App-Funktionalität ist das Notes-/Workflow-Modell (Braindump, Review, Gedanken, To-Do).
