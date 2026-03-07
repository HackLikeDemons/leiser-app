# Sync Contract (Verbindlich)

Dieses Dokument definiert die verbindlichen Regeln fuer Sync, Konflikte, Deletes, Retention und Reconnect.

## 1. Datengrundsaetze

- Primare Entitaet: `Note` (identifiziert ueber `id`).
- Sync-Transport: Envelope pro Aenderung mit optionalem Snapshot.
- Zielzustand: Alle gekoppelten Clients konvergieren auf denselben Datensatz pro Raum.

## 2. Konfliktregeln (deterministisch)

Beim Vergleich zweier Versionen derselben Note gilt in dieser Reihenfolge:

1. Hoehere `revision` gewinnt.
2. Bei gleicher `revision`: neueres `updatedAt` gewinnt.
3. Bei Gleichstand: neueres `createdAt`.
4. Bei Gleichstand: spaeteres `deletedAt`.
5. Envelope-Tie-Breaker: `changeId` (lexikographisch).

Es gibt keine benutzersichtbare "manual merge"-Stufe.

## 3. Delete-Regeln

- Soft-Delete: `deletedAt != null`.
- Soft-deleted Notes gelten als inaktiv und werden nicht als aktive Inhalte angezeigt.
- Backups (Standard-Export) enthalten nur aktive Notes (keine `deletedAt`, kein `ARCHIVE`, kein `DISCARD`).

## 4. Retention-Regeln

- `TODO -> INBOX` (Wiedervorlage), wenn `updatedAt` aelter als 14 Tage.
- `ARCHIVE` Hard-Delete, wenn `updatedAt` aelter als 30 Tage.
- Hard-Delete entfernt Eintrag aus lokalen Stores und bereinigt betroffene Outbox-Eintraege.
- Beim Sync werden abgelaufene Archiv-Snapshots nicht mehr wieder aufgenommen.

## 5. Offline/Reconnect-Regeln

Reihenfolge fuer einen Sync-Lauf:

1. `pull` Remote-Zustand
2. `merge` (deterministisch)
3. lokale pending Envelopes hinzufuegen
4. `push` mit Versionspruefung
5. bei Version-Konflikt: re-pull/re-merge/retry

Beim ersten Lauf werden fehlende Bestandsdaten per Snapshot-Envelopes in die Outbox nachgezogen.

## 6. Invarianten (muessen immer gelten)

- Keine doppelten Notes pro `id`.
- Nach Maintenance-Lauf:
  - keine `TODO` aelter als 14 Tage
  - keine `ARCHIVE` aelter als 30 Tage
- Gekoppelte Clients in demselben Raum konvergieren nach abgeschlossenem Sync.

## 7. Nicht-Ziele

- Kein serverseitiges Nutzerkonto-basiertes Konflikt-UI.
- Kein partielles Selective-Merge durch Endnutzer.

## 8. Aenderungspolitik

Aenderungen an den Regeln in diesem Dokument erfordern:

- Update der Implementierung,
- Update der E2E-Szenarien,
- Regression-Tests fuer betroffene Konflikt-/Retention-Faelle.
