# Entwicklung

[Zurück zur README](../README.md) · [Deploy](deploy-netlify.md) · [Testen](testing.md)

## Voraussetzungen

- Node.js 20+
- npm

## Setup

```bash
npm install
```

## Lokale Entwicklung

```bash
npm run dev
```

## Lint

```bash
npm run lint
```

## Build

```bash
npm run build
```

Der Produktions-Build splittet schwere Abhaengigkeiten bewusst in eigene Chunks:

- `vendor-automerge` fuer CRDT/WASM
- `syncEngine` fuer den optionalen Sync-Pfad
- `backup` fuer Import/Export

Das reduziert das Initial-Bundle, ohne den bestehenden Offline-/Persistenzpfad zu veraendern.

## Preview

```bash
npm run preview
```

## Docker

Fuer reproduzierbare lokale Container-Builds liegt ein repo-eigenes [`Dockerfile`](../Dockerfile) vor. Es baut immer aus dem aktuellen Workspace-Inhalt und nicht aus einem extern geklonten Repository.

## Architekturhinweis

- Die App nutzt aktuell keinen Client-Router.
- Es gibt keinen Demo-Seed-Pfad im produktiven Code.
- Such-/Filterlogik verwendet keine externe Fuzzy-Search-Bibliothek.
- Storage-Zugriffe mit potenziell blockierbarem Browser-API-Verhalten laufen ueber kleine Helper statt verteilt ueber die UI.
- PWA-Precache bleibt bewusst klein; grosse CRDT-Chunks werden nicht zwangsweise offline vorab geladen.

## Hinweis zu TypeScript-Events

Bei globalen Browser-Listenern (`window.addEventListener`) DOM-Eventtypen verwenden. React-Eventtypen (`React.KeyboardEvent`) nur in React-Handlern einsetzen.
