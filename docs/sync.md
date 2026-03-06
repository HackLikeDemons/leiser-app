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
- Pair-Code ist in der UI ausgeblendet und nur über Aktionen nutzbar (kopieren / QR)

## Ablauf (vereinfacht)

1. Pull remote blob
2. Remote-Änderungen lokal anwenden
3. lokale Outbox in kombinierten Blob mergen
4. Push mit optimistic concurrency (`version`)
5. bei Konflikt: re-pull/re-merge/retry

Beim erstmaligen Abgleich eines Geräts werden fehlende Bestandsdaten per Snapshot-Envelopes nachgezogen.

## Neuen Client in Betrieb nehmen

### Fall A: Eigener Vault (nicht mit anderen Geräten teilen)

1. App auf dem neuen Client öffnen.
2. In den Datenbereich gehen (`...` im Header) und `Sync aktivieren`.
3. Die App vergibt beim Aktivieren automatisch eine eigene `roomId` (UUID) und ein eigenes `syncToken`.
4. Keinen Pair-Code von anderen Geräten importieren.

Ergebnis: Dieser Client synchronisiert nur mit Geräten, die exakt denselben Pair-Code erhalten.

### Fall B: Neuen Client mit bestehenden Clients synchronisieren

1. Auf einem bereits gekoppelten Gerät im Datenbereich den Pair-Code öffnen (`Pair Code kopieren`, `QR anzeigen`).
2. Auf dem neuen Client den Pair-Code importieren (`Pair Code einfügen` oder QR-Scan).
3. Die App übernimmt `roomId` und `syncToken` vom bestehenden Gerät und startet den Abgleich.
4. Mit `Sync now (Debug)` optional sofort einen manuellen Lauf auslösen.

Ergebnis: Der neue Client hängt im selben Vault wie die bestehenden Geräte.

### Hinweis zu `roomId = default`

- `default` ist ein technischer Fallbackwert für frische lokale Zustände ohne gesetzte Room-ID.
- Für produktive, aktivierte Sync-Setups sollte eine eigene Room-ID (UUID) verwendet werden.
- Falls ein altes Setup noch auf `default` steht: einmal `Sync deaktivieren` und wieder `Sync aktivieren`, dann wird eine eigene Room-ID erzeugt.

## Betriebsverhalten

- Debounced Push nach lokalen Änderungen (aktuell ca. `600ms`)
- periodischer Pull (aktuell ca. alle `4s`)
- zusätzlicher Pull bei Fokus/Visibility
- Debug-Infos standardmäßig ausgeblendet
- manuelles Diagnose-Exportformat per `Sync-Protokoll kopieren`

## Sicherheitshinweise

- Sync ist optional. Ohne Supabase läuft Leiser vollständig lokal.
- Wenn alle Geräte die lokalen Browserdaten verlieren, ist ohne gesicherten Pair-Code kein Zugriff auf denselben Sync-Raum mehr möglich.
- Pair-Code deshalb extern sicher speichern.
