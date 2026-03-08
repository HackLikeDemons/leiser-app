# Backup und Import

[Zurück zur README](../README.md) · [Datenmodell](data-model.md)

## Export

- Exportiert aktive Notes als JSON
- ohne soft-deleted Einträge (`deletedAt`)
- ohne `ARCHIVE` und ohne `DISCARD`
- Dateiname: `leiser-backup-YYYY-MM-DD.json`
- arbeitet je nach Gerät mit Datei-Download oder Share-Sheet

## Reihenfolge bei Neuaufbau mit neuem Sync-Raum

1. Auf dem Quell-Client `Backup exportieren`.
2. Quell-Client bereinigen.
3. Neuen Sync-Raum anlegen.
4. Backup importieren.
5. Sync auf dem Quell-Client aktivieren und mindestens einen manuellen Lauf (`Jetzt syncen`) abschließen.
6. Erst danach weitere Clients bereinigen und per Pair-Code beitreten lassen.

## Import-Modi

- `MERGE`
  - führt per `id` zusammen
- `REPLACE`
  - ersetzt lokalen Stand komplett

## Backup-Status in der UI

Im Datenbereich (`...` -> `Einstellungen` -> `Backup`) zeigt Leiser:

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

## Aufbewahrung

- Es gibt keine automatische Verschiebung aktiver Einträge mehr nach `ARCHIVE`.
- Einträge im Status `ARCHIVE` werden nach 30 Tagen automatisch endgültig gelöscht (Hard-Delete).
