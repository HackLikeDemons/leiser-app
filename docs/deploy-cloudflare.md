# Deploy auf Cloudflare Pages

[Zurück zur README](../README.md) · [Entwicklung](development.md) · [Testen](testing.md)

## Build-Einstellungen

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`

## SPA Routing

Für Cloudflare Pages ist keine Netlify-`_redirects`-Regel nötig.

- Kein Deploy-Command wie `npx wrangler deploy` in den Pages-Build-Einstellungen setzen
- Kein `/* /index.html 200` mit ausliefern
- Cloudflare Pages liefert stattdessen die App über den nativen SPA-Fallback aus

## Runtime-Config

Bevorzugt Supabase-Werte in Cloudflare Pages als Build-Variablen setzen:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Optional kann lokal weiterhin eine `public/config/runtime.json` aus dem Template erzeugt werden. Diese Datei ist im Repo ignoriert.

Datei `public/config/runtime.json` wird, falls vorhanden, mit `Cache-Control: no-store` ausgeliefert.

Datei `public/_headers`:

```text
/config/runtime.json
  Cache-Control: no-store
```

## Kurzablauf

1. Repo zu GitHub pushen
2. In Cloudflare Pages: `Create a project` und Repo verbinden
3. Build/Output wie oben setzen
4. Deploy starten
5. Domain zuweisen

## Hinweise

- Die App ist ein statisches Vite-Build; Wrangler ist dafür nicht erforderlich
- Falls `leiser.app` als Apex-Domain genutzt wird, ist die Domain-Verwaltung über Cloudflare am einfachsten
- Für Subdomains reicht in der Regel ein `CNAME` auf `<projekt>.pages.dev`
- Fuer Cloudflare Pages ist der einfachste Weg, die Supabase-Werte als Environment Variables im Projekt zu hinterlegen
