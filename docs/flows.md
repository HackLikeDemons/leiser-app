# Flows und Tabs

[Zurück zur README](../README.md) · [Produktüberblick](overview.md)

## Erfassen

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

## Sortieren

- `INBOX`-Entscheidung als Liste mit Priorisierung nach Alter
- Entscheidungen:
  - Handeln (`TODO`)
  - Reflektieren (`PROCESS`)
  - Verwerfen (`DISCARD`)
- Leere Inbox zeigt direkte Weiterleitungen zu `Reflektieren` und `Handeln`
- zusätzlicher Stale-Review-Bereich für alte Handlungen (>14 Tage)

## Reflektieren

- Zeigt `PROCESS`
- Aktionen pro Note:
  - Archivieren (`ARCHIVE` mit Bucket `THINKING`)
  - Zu Handeln (`TODO`)
  - endgültig löschen
- eigenes Archiv kann eingeblendet werden
- wenn der letzte Archiv-Eintrag gelöscht wird, klappt das Archiv automatisch zu

## Handeln

- Zeigt `TODO`
- Tagesweise gruppiert
- Filterleiste (Bereich, Wichtig-Filter, Suche) ist auch auf Mobile in einer Zeile nutzbar
- optionaler Stern-Filter
- Aktionen:
  - Erledigt (verschiebt ins Handeln-Archiv)
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
