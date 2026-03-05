# Flows und Tabs

[Zurück zur README](../README.md) · [Produktüberblick](overview.md)

## Braindump

- Eingabe im Composer (unten)
- `Enter` speichert
- `Shift+Enter` fügt Zeilenumbruch ein
- Fokus bleibt im Feld

Darstellung:

- Tagesdivider (`Heute`, `Gestern`, Datum)
- Einträge im Flow (chronologisch)
- ruhige Listenoptik, Aktionen pro Item
- sehr alte Einträge werden automatisch in den Archiv-Status verschoben (ohne Löschung)

## Review

- `INBOX`-Entscheidung mit umschaltbarer Darstellung:
  - `Auto` (Default)
  - `Single`
  - `Liste`
- Entscheidungen:
  - To-Do (`TODO`)
  - Gedanken (`PROCESS`)
  - Verwerfen (`DISCARD`)
  - Überspringen
- „Heute entschieden“ ist einklappbar
- Undo für letzte Entscheidung (zeitlich begrenzt)

## Gedanken

- Zeigt `PROCESS`
- Aktionen pro Note:
  - Archivieren (`ARCHIVE`)
  - Zu To-Do (`TODO`)
  - Verwerfen (`DISCARD`)
- eigenes Gedanken-Archiv kann eingeblendet werden

## To-Do

- Zeigt `TODO`
- Tagesweise gruppiert
- optionaler Stern-Filter
- Aktionen:
  - Erledigt (verschiebt ins To-Do-Archiv)
  - Zurück in Inbox
- mit kurzem Undo-Feedback
- eigenes To-Do-Archiv kann eingeblendet werden

## Globales Header-Menü (`...`)

- Theme wechseln
- Backup exportieren
- Backup importieren
- Datenbereich öffnen
