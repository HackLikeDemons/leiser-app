# Backup und Import

[Zurück zur README](../README.md) · [Datenmodell](data-model.md)

## Export

- Exportiert alle Notes als JSON
- enthält auch soft-deleted Einträge (`deletedAt`)
- Dateiname: `leiser-backup-YYYY-MM-DD.json`

## Import-Modi

- `MERGE`
  - führt per `id` zusammen
- `REPLACE`
  - ersetzt lokalen Stand komplett

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
