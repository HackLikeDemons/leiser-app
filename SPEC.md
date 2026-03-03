# Leiser – Basis-Spec (lokal, offline)

## Ziel
Leiser ist ein rein lokales Wochenblatt-Tool für vollzeitbeschäftigte Eltern.
Kein Backend. Keine Tracker. Offline-first. Daten bleiben auf dem Gerät (IndexedDB).

## Datenmodell

### WeekEntry
`weekStartISO` ist die **logische ID** einer Woche (Montag als Start, ISO-Woche).

```ts
type Mode = "STABIL" | "ANGESPANNT" | "UEBERLAST" | "KRISE";

type WeekEntry = {
  id: string;                 // technische ID (uuid), darf sich ändern
  weekStartISO: string;        // logische ID (YYYY-MM-DD), immer Montag
  mode: Mode;

  priorities: [string, string, string];
  bottleneck: string;
  intentionallyNotDoing: string;

  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
};
```
