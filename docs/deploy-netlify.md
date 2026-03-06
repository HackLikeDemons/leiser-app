# Deploy auf Netlify

[Zurück zur README](../README.md) · [Entwicklung](development.md) · [Testen](testing.md)

## Build-Einstellungen

- Build command: `npm run build`
- Publish directory: `dist`

## SPA Routing

Datei `public/_redirects`:

```text
/* /index.html 200
```

## HTTPS / iOS

Für PWA-Funktionen auf iPhone ist HTTPS nötig:

- Service Worker
- Installation auf Homescreen
- Offline-Start

## Kurzablauf

1. Repo zu GitHub pushen
2. In Netlify: New site from Git
3. Build/Publish setzen
4. Deploy starten

## Troubleshooting Build

- Prüfe bei TypeScript-Fehlern Eventtypen in `src/App.tsx`:
  - globale Listener mit DOM-Eventtypen
  - React-Eventtypen nur in JSX-Handlern
- lokal gegenprüfen:

```bash
npm run lint
npm run build
```
