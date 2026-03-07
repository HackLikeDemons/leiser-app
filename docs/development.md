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

## Preview

```bash
npm run preview
```

## Architekturhinweis

- Die App nutzt aktuell keinen Client-Router.
- Es gibt keinen Demo-Seed-Pfad im produktiven Code.
- Such-/Filterlogik verwendet keine externe Fuzzy-Search-Bibliothek.

## Hinweis zu TypeScript-Events

Bei globalen Browser-Listenern (`window.addEventListener`) DOM-Eventtypen verwenden. React-Eventtypen (`React.KeyboardEvent`) nur in React-Handlern einsetzen.
