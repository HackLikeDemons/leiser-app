# Optionaler Supabase Sync

[Zurück zur README](../README.md) · [Datenmodell](data-model.md) · [Deploy](deploy-netlify.md)

## Ziel

Geräte können optional über Supabase synchronisieren, ohne klassisches Nutzerkonto.

## Konfiguration

Über `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

oder zur Laufzeit per `localStorage`.

## Auth-Modell

- Pairing über `roomId` + `syncToken`
- Header: `x-leiser-token`
- in Supabase wird nur `token_hash` gespeichert

## Ablauf (vereinfacht)

1. Pull remote blob
2. Remote-Änderungen lokal anwenden
3. lokale Outbox in kombinierten Blob mergen
4. Push mit optimistic concurrency (`version`)
5. bei Konflikt: re-pull/re-merge/retry

## Betriebsverhalten

- Debounced Push nach lokalen Änderungen
- periodischer Pull
- zusätzlicher Pull bei Fokus/Visibility
- stiller Status in der UI

## Hinweis

Sync ist optional. Ohne Supabase läuft Leiser vollständig lokal.
