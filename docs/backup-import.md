# Backup und Import

[Zurück zur README](../README.md) · [Datenmodell](data-model.md)

## Export

- Exportiert alle Notes als JSON
- enthält auch soft-deleted Einträge (`deletedAt`)
- Dateiname: `leiser-backup-YYYY-MM-DD.json`
- arbeitet je nach Gerät mit Datei-Download oder Share-Sheet

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
