# Flows und Tabs

[Zurück zur README](../README.md) · [Produktüberblick](overview.md)

## Sammeln

- Eingabe im Composer (unten)
- `Enter` speichert
- `Shift+Enter` fügt Zeilenumbruch ein
- Fokus bleibt im Feld
- Mikrofon-Button für Diktat ist verfügbar
- `#bereich` setzt den Bereich als Metadatum; der Tag wird beim Speichern aus dem Notiztext übernommen

Darstellung:

- Tagesdivider (`Heute`, `Gestern`, Datum)
- Einträge im Flow (chronologisch)
- ruhige Listenoptik, Aktionen pro Item
- sehr alte Einträge werden automatisch in den Archiv-Status verschoben (ohne Löschung)

## Ordnen

- `INBOX`-Entscheidung als Liste mit Priorisierung nach Alter
- Ziel des Tabs: aus losem Eingang klare nächste Schritte machen
- pro Eintrag zusätzliches `...`-Aktionsmenü mit textuellen Aktionen (neben den Schnell-Icons)
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
  - Bearbeiten (Text + Bereich)
  - Archivieren (`ARCHIVE` mit Bucket `THINKING`)
  - Zu Machen (`TODO`)
  - endgültig löschen (im Archiv)
- eigenes Archiv kann eingeblendet werden
- wenn der letzte Archiv-Eintrag gelöscht wird, klappt das Archiv automatisch zu

## Machen

- Zeigt `TODO`
- Ziel des Tabs: nächste Schritte konsequent abarbeiten
- pro Eintrag zusätzliches `...`-Aktionsmenü mit textuellen Aktionen
- Tagesweise gruppiert
- Filterleiste (Bereich, Wichtig-Filter, Suche) ist auch auf Mobile in einer Zeile nutzbar
- optionaler Stern-Filter
- Aktionen:
  - Bearbeiten (Text + Bereich)
  - Erledigt (verschiebt ins Machen-Archiv)
  - In Memos (`PROCESS`)
- eigenes Archiv kann eingeblendet werden
- wenn der letzte Archiv-Eintrag gelöscht wird, klappt das Archiv automatisch zu

## Datenbereich (`...` im Header)

- Aufruf über `...` -> `Einstellungen` -> `Sync`
- Hero: `Sichern, verbinden, verwalten`
- Karte `Sync`:
  - Sync aktivieren/deaktivieren
  - `Sync now (Debug)`
  - Debug-Infos ein-/ausblenden (standardmäßig aus)
  - `Sync-Protokoll kopieren`
- Karte `Geräte koppeln`:
  - QR-Code anzeigen / QR scannen
  - Pair-Code ist in der UI aus Sicherheitsgründen ausgeblendet
  - Pair-Code kann kopiert und auf anderem Gerät importiert werden

## Backup (`...` im Header)

- Aufruf über `...` -> `Einstellungen` -> `Backup`
- Aktionen:
  - Backup exportieren
  - Backup importieren
  - Import-Modus `Zusammenführen` oder `Ersetzen`
- Status:
  - `Letztes Backup`
  - `Backup überfällig` + `Jetzt sichern`

## Kontextmenü (`...` im Header)

- `Einstellungen`
  - Einstieg zu `Sync`
  - Einstieg zu `Backup`
  - Einstieg zu `Bereiche bearbeiten`
- `Bereiche bearbeiten` (über `Einstellungen`): Verwaltung für Bereiche mit Modus `Bearbeiten` / `Fertig`
  - Standardansicht zeigt nur die aktuelle Bereichsliste
  - im Bearbeiten-Modus: Bereiche umbenennen, entfernen, neu anlegen
  - Beim Entfernen eines Bereichs werden vorhandene Einträge auf `Ohne Bereich` gesetzt
  - Nach Backup-Import werden Einträge mit nicht mehr konfigurierten Bereichen ebenfalls auf `Ohne Bereich` gesetzt
- `Über Leiser`
