# Sync E2E Matrix (Mehr-Client)

[Zurueck zur Sync-Doku](sync.md) · [Sync Contract](../SYNC_CONTRACT.md)

Ziel: reproduzierbare Szenarien mit erwarteten Endzustaenden.

## Setup

- Mindestens zwei Clients (`A`, `B`), optional `C`.
- Eigener Testraum pro Szenario.
- Vor jedem Szenario: Clients bereinigen, neuen Raum erzeugen/koppeln.

## Szenarien

### S1: Parallel-Edit derselben Note

- Ausgang: `A` und `B` haben dieselbe Note.
- Schritt: beide editieren offline dieselbe Note, danach online syncen.
- Erwartung:
  - Endzustand auf allen Clients identisch.
  - Gewinner gemaess Konfliktregeln (Revision, dann `updatedAt`, ...).

### S2: Delete vs Update Konflikt

- Ausgang: gleiche Note auf `A` und `B`.
- Schritt: `A` soft-deleted, `B` aktualisiert Text, danach Sync.
- Erwartung:
  - deterministischer Endzustand gemaess Contract.
  - kein Duplikat, kein inkonsistenter Zwischenzustand.

### S3: Import/Neuaufbau mit neuem Raum

- Schrittfolge:
  1. `A`: Backup exportieren
  2. `A`: Client bereinigen
  3. `A`: neuen Sync-Raum erstellen
  4. `A`: Backup importieren
  5. `A`: Sync-Lauf abschliessen
  6. `B`: bereinigen, Pair-Code von `A` importieren
- Erwartung:
  - `B` erhaelt vollstaendigen Bestand.
  - Inhalte aus Review/Thinking/Todo sind vollstaendig vorhanden.

### S4: Offline-Queue und Reconnect

- Ausgang: `A` offline, `B` online.
- Schritt: `A` erstellt/editiert mehrere Notes, dann reconnect.
- Erwartung:
  - keine verlorenen Aenderungen.
  - Outbox wird sauber abgearbeitet.

### S5: Retention - Wiedervorlage TODO

- Ausgang: TODO mit `updatedAt` > 14 Tage.
- Schritt: Maintenance/Refresh ausloesen.
- Erwartung:
  - Note wechselt nach `INBOX`.
  - Aenderung wird synchronisiert.

### S6: Retention - Hard-Delete ARCHIVE

- Ausgang: ARCHIVE mit `updatedAt` > 30 Tage.
- Schritt: Maintenance/Refresh ausloesen.
- Erwartung:
  - Note lokal entfernt.
  - keine Wiederauferstehung nach Sync.

### S7: Remote-Changed Retry

- Schritt: simultane Pushes von `A` und `B` erzwingen.
- Erwartung:
  - Retry-Pfad greift.
  - kein Datenverlust, konsistenter Endzustand.

### S8: Pairing-Rekey

- Schritt: Verbund neu schluesseln (neuer Raum/Token), verbleibende Clients neu koppeln.
- Erwartung:
  - alte Clients ohne Neukopplung erhalten keine neuen Daten.

## Checkliste pro Szenario

- [ ] Finaler Datensatz auf allen gekoppelten Clients identisch
- [ ] Keine Duplikate pro `id`
- [ ] Keine Notes in ungueltigem Status
- [ ] Retention-Invarianten eingehalten
- [ ] Sync-Diagnostik ohne ungeklaerte Fehler

## Hinweise zur Automatisierung

- Szenarien als Playwright E2E mit getrennten Browser-Kontexten modellieren (`A`, `B`, `C`).
- Fuer Zeitfaelle (`14/30 Tage`) Testdaten direkt mit manipuliertem `updatedAt` anlegen.
- Golden-State als JSON-Snapshot vergleichen (sortiert nach `id`).
