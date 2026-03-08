# Flows und Tabs

[Zurück zur README](../README.md) · [Produktüberblick](overview.md)

## Erfassen

- Eingabe im Composer (unten)
- `Enter` speichert
- `Shift+Enter` fügt Zeilenumbruch ein
- Fokus bleibt im Feld
- Mikrofon-Button für Diktat ist verfügbar
- `#kontext` setzt den Kontext als Metadatum; der Tag wird beim Speichern aus dem Notiztext übernommen
- `-` am Anfang erstellt direkt eine Handlung (`TODO`) statt eines Inbox-Eintrags

Darstellung:

- Tagesdivider (`Heute`, `Gestern`, Datum)
- Einträge im Flow (chronologisch)
- ruhige Listenoptik, Aktionen pro Item
- sehr alte Archiv-Einträge werden nach 30 Tagen dauerhaft gelöscht

## Inbox

- `INBOX`-Entscheidung als Liste mit Priorisierung nach Alter
- Ziel des Tabs: aus losem Eingang klare nächste Schritte machen
- pro Eintrag zusätzliches `...`-Aktionsmenü mit textuellen Aktionen
- Entscheidungen:
  - Machen (`TODO`)
  - Memos (`PROCESS`)
  - Verwerfen (`DISCARD`)
- Leere Inbox zeigt direkte Weiterleitungen zu `Memos` und `Machen`
- zusätzlicher Stale-Review-Bereich für alte Handlungen (>14 Tage)

## Memos

- Zeigt `PROCESS`
- Ziel des Tabs: offene Memos vertiefen, bevor sie in konkrete Handlungen gehen
- pro Eintrag zusätzliches `...`-Aktionsmenü mit textuellen Aktionen
- Aktionen pro Note:
  - Bearbeiten (Text + Kontext)
  - Archivieren (`ARCHIVE` mit Bucket `THINKING`)
  - Zu Machen (`TODO`)
  - endgültig löschen (im Archiv)
- Kontext-Filter inkl. `Ohne Kontext`
- eigenes Archiv kann eingeblendet werden
- wenn der letzte Archiv-Eintrag gelöscht wird, klappt das Archiv automatisch zu

## Machen

- Zeigt `TODO`
- Ziel des Tabs: nächste Schritte konsequent abarbeiten
- pro Eintrag zusätzliches `...`-Aktionsmenü mit textuellen Aktionen
- Tagesweise gruppiert
- Filterleiste (Kontext, Wichtig-Filter, Suche) ist auch auf Mobile in einer Zeile nutzbar
- optionaler Stern-Filter
- Aktionen:
  - Bearbeiten (Text + Kontext)
  - Erledigt (verschiebt ins Handlungs-Archiv)
  - In Memos (`PROCESS`)
- Kontext-Filter inkl. `Ohne Kontext`
- eigenes Archiv kann eingeblendet werden
- wenn der letzte Archiv-Eintrag gelöscht wird, klappt das Archiv automatisch zu

## Einstellungen (`...` im Header)

- Aufruf über `...` -> `Einstellungen`
- Einstiege zu:
  - `Kontexte bearbeiten`
  - `Backup`
  - `Geräte-Sync (optional)`
- Option `Hilfetexte in Haupt-Tabs reduzieren`

## Geräte-Sync (`Einstellungen` -> `Geräte-Sync`)

- Sync aktivieren/deaktivieren
- `Jetzt syncen`
- Aktionen: `Neuen Sync-Raum erstellen`, `Client aus Verbund entfernen`, `Client bereinigen`
- Pairing:
  - QR-Code anzeigen / QR scannen
  - Pair-Code kann kopiert und auf anderem Gerät importiert werden
- Debug-Infos ein-/ausblenden
- `Sync-Protokoll kopieren`

## Backup (`Einstellungen` -> `Backup`)

- Aktionen:
  - Backup exportieren
  - Backup importieren
  - Import-Modus `Zusammenführen` oder `Ersetzen`
- Status:
  - `Letztes Backup`
  - `Backup überfällig` + `Jetzt sichern`

## Kontexte (`Einstellungen` -> `Kontexte bearbeiten`)

- Kontextliste anzeigen, umbenennen, entfernen, neu anlegen
- Beim Entfernen eines Kontexts werden vorhandene Einträge auf `Ohne Kontext` gesetzt
- Nach Backup-Import werden Einträge mit unbekannten Kontexten auf `Ohne Kontext` gesetzt

## Kontextmenü (`...` im Header)

- `Einstellungen`
- `Über Leiser`
