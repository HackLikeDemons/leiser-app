# Backup und Import

[Zurück zur README](../README.md) · [Datenmodell](data-model.md)

## Export

- Exportiert alle Notes als JSON
- enthält auch soft-deleted Einträge (`deletedAt`)
- Dateiname: `leiser-backup-YYYY-MM-DD.json`
- arbeitet je nach Gerät mit Datei-Download oder Share-Sheet
- Optional: `Aktive Einträge exportieren` (ohne `deletedAt`, ohne `ARCHIVE`, ohne `DISCARD`)

## Reihenfolge bei Neuaufbau mit neuem Sync-Raum

1. Auf dem Quell-Client aktiven Export erstellen.
2. Quell-Client bereinigen.
3. Neuen Sync-Raum anlegen.
4. Backup importieren.
5. Sync auf dem Quell-Client aktivieren und mindestens einen manuellen Lauf (`Sync now (Debug)`) abschließen.
6. Erst danach weitere Clients bereinigen und per Pair-Code beitreten lassen.

## Import-Modi

- `MERGE`
  - führt per `id` zusammen
- `REPLACE`
  - ersetzt lokalen Stand komplett

## Backup-Status in der UI

Im Datenbereich (`...` -> `Backup und Sync`) zeigt Leiser:

- `Letztes Backup: <Zeitpunkt>`
- `Backup überfällig` nach 7 Tagen ohne Export
- Button `Jetzt sichern` für den schnellen Export

## JSON-Format

```json
{
  "app": "Leiser",
  "schemaVersion": 1,
  "exportedAt": "<ISO>",
  "deviceId": "<device-id>",
  "notes": []
}
```

## Merge-Konfliktregel (`MERGE`)

1. höhere `revision` gewinnt
2. bei gleicher `revision`: neueres `updatedAt` gewinnt
3. bei Gleichstand: lokale Version bleibt

`deletedAt` wird als Tombstone mitgeführt.

## Empfehlung

- Pair-Code sicher extern hinterlegen (z. B. Passwortmanager)
- regelmäßigen Export als Offline-Backup einplanen
