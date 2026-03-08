# Flows und Tabs

[Zurück zur README](../README.md) · [Produktüberblick](overview.md)

## Sammeln

- Eingabe im Composer (unten)
- `Enter` speichert
- `Shift+Enter` fügt Zeilenumbruch ein
- Fokus bleibt im Feld
- Mikrofon-Button für Diktat ist verfügbar

Darstellung:

- Tagesdivider (`Heute`, `Gestern`, Datum)
- Einträge im Flow (chronologisch)
- ruhige Listenoptik, Aktionen pro Item
- sehr alte Einträge werden automatisch in den Archiv-Status verschoben (ohne Löschung)

## Ordnen

- `INBOX`-Entscheidung als Liste mit Priorisierung nach Alter
- Entscheidungen:
  - Machen (`TODO`)
  - Denken (`PROCESS`)
  - Verwerfen (`DISCARD`)
- Leere Inbox zeigt direkte Weiterleitungen zu `Denken` und `Machen`
- zusätzlicher Stale-Review-Bereich für alte Handlungen (>14 Tage)

## Denken

- Zeigt `PROCESS`
- Aktionen pro Note:
  - Archivieren (`ARCHIVE` mit Bucket `THINKING`)
  - Zu Machen (`TODO`)
  - endgültig löschen
- eigenes Archiv kann eingeblendet werden
- wenn der letzte Archiv-Eintrag gelöscht wird, klappt das Archiv automatisch zu

## Machen

- Zeigt `TODO`
- Tagesweise gruppiert
- Filterleiste (Bereich, Wichtig-Filter, Suche) ist auch auf Mobile in einer Zeile nutzbar
- optionaler Stern-Filter
- Aktionen:
  - Erledigt (verschiebt ins Machen-Archiv)
  - Zurück in Inbox
- eigenes Archiv kann eingeblendet werden
- wenn der letzte Archiv-Eintrag gelöscht wird, klappt das Archiv automatisch zu

## Datenbereich (`...` im Header)

- Hero: `Sichern, verbinden, verwalten`
- Karte `Backup und Sync`:
  - Backup exportieren/importieren
  - Sync aktivieren/deaktivieren
  - `Sync now (Debug)`
  - Debug-Infos ein-/ausblenden (standardmäßig aus)
  - `Sync-Protokoll kopieren`
  - `Letztes Backup` + `Backup überfällig` Hinweis + `Jetzt sichern`
- Karte `Geräte koppeln`:
  - QR-Code anzeigen / QR scannen
  - Pair-Code ist in der UI aus Sicherheitsgründen ausgeblendet
  - Pair-Code kann kopiert und auf anderem Gerät importiert werden

## Kontextmenü (`...` im Header)

- `Bereiche bearbeiten`: Verwaltung für Bereiche mit Modus `Bearbeiten` / `Fertig`
  - Standardansicht zeigt nur die aktuelle Bereichsliste
  - im Bearbeiten-Modus: Bereiche umbenennen, entfernen, neu anlegen
  - Beim Entfernen eines Bereichs werden vorhandene Einträge auf `Ohne Bereich` gesetzt
  - Nach Backup-Import werden Einträge mit nicht mehr konfigurierten Bereichen ebenfalls auf `Ohne Bereich` gesetzt
- `Sync & Backup`
- `Über Leiser`
