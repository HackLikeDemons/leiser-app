# Test-Checklisten

[Zurück zur README](../README.md) · [Flows](flows.md) · [Sync](sync.md)

## Basis-Check

1. `Erfassen`: Eintrag speichern, Reload -> bleibt erhalten
2. `Sortieren`: Entscheidungen nach `Handeln`, `Reflektieren`, `Verwerfen` funktionieren
3. `Reflektieren`: Archivieren/Löschen/Zu Handeln -> korrekt umgesetzt
4. `Handeln`: Tagesgruppierung, Stern-Filter, Zurück in Inbox, Erledigt -> korrekt umgesetzt
5. Archiv-Autoclose: letzten Archiv-Eintrag löschen -> Archiv klappt automatisch zu
6. Globale Shortcuts: `1/2/3/4` wechseln Tabs; in Eingabefeldern inaktiv

## Kontext (kontrolliert)

1. Altdaten ohne `context` laden ohne Fehler
2. In `Sortieren` pro Item `Bereich` setzen, ändern und auf `Kein Bereich` zurücksetzen
3. Nur erlaubte Werte (`arbeit`, `familie`, `finanzen`, `freunde`, `gesundheit`, `haushalt`, `privat`, `projekt`) werden gespeichert
4. Ungültige `context`-Werte aus manipuliertem Backup/Sync führen nicht zu Crash und werden verworfen
5. Statuswechsel (`INBOX/PROCESS/TODO/ARCHIVE/DISCARD`), Archivieren, Löschen und Stern-Filter funktionieren unverändert mit und ohne `context`
6. Sync zweier Geräte mit Item `mit` und `ohne` `context` (inkl. Änderung/Entfernung) bleibt konsistent

## Backup/Import

1. Export erzeugen
2. `Letztes Backup`-Zeitpunkt aktualisiert sich
3. `Backup überfällig` erscheint nach >7 Tagen ohne Export
4. Import `MERGE` testen
5. Import `REPLACE` testen

## Offline

1. App laden
2. Netzwerk trennen
3. weiter nutzen

## Sync/Pairing

1. Pair-Code ist nicht sichtbar, aber `Pair Code kopieren` funktioniert
2. QR-Flow funktioniert (anzeigen/scannen)
3. `Sync now (Debug)` auf zwei Geräten: neue und historische Einträge erscheinen auf beiden Seiten
4. `Sync-Protokoll kopieren` liefert JSON mit Diagnosefeldern

## iPhone PWA Check

- Install ok: `offen`
- Offline-Start ok: `offen`
- Safe Area ok: `offen`

Ablauf:

1. HTTPS URL in Safari öffnen
2. Teilen -> Zum Home-Bildschirm
3. App starten
4. einmal durch Tabs navigieren (Assets cachen)
5. Flugmodus
6. App schließen
7. erneut starten
