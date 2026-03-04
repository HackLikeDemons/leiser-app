# Leiser

Leiser ist ein lokales, offline-fähiges Gedanken-Tool mit Fokus auf schnellen Capture-Flow.

- Keine Cloud
- Kein Backend
- Keine Tracker
- Daten bleiben lokal im Browser (IndexedDB)

## Features

### Braindump
- Schnelles Erfassen von Gedanken (Textarea)
- `Enter` speichert, `Shift+Enter` macht Zeilenumbruch
- Mehrzeiliges Paste wird in mehrere Notizen aufgeteilt
- Tages-Divider in der Liste (`Heute`, `Gestern`, `YYYY-MM-DD`)
- Direkte Aktionen pro Notiz (z. B. Löschen, ggf. Rückgängig bei frischen Einträgen)

### Review
- Single-Card Review für `INBOX`-Notizen
- Aktionen: `To-Do`, `Denken`, `Verwerfen`, `Überspringen`
- Tastenkürzel: `t`, `p`, `d`, `s`, `Esc`
- Undo für die letzte Entscheidung (zeitlich begrenzt)
- Optionaler Stale-To-Do-Review (`TODO` älter als 14 Tage)

### Denken
- Zeigt `PROCESS`-Notizen
- Direkte Aktionen pro Notiz: Archivieren, Zu To-Do, Verwerfen
- Einblendbares Archiv (`ARCHIVE`) mit Rückführung nach Denken

### To-Do
- Zeigt `TODO`-Notizen
- Gruppierung bei längeren Listen: `Heute`, `Diese Woche`, `Älter`
- Gruppe `Älter` zeigt Hinweis `>14 Tage: X`
- Direkte Aktionen pro Notiz: Erledigt, Zurück

### Header-Menü (`...`)
- Oben rechts befindet sich ein Kontextmenü für globale Aktionen:
  - Theme wechseln (hell/dunkel)
  - Backup exportieren
  - Backup importieren
  - Datenbereich öffnen/schließen

## Tastenkürzel (ausführlich)

### Braindump (Textarea)
- `Enter`
  - Speichert den aktuellen Gedanken sofort.
  - Leerer Text wird ignoriert.
  - Nach dem Speichern bleibt der Fokus im Eingabefeld.
- `Shift+Enter`
  - Fügt einen Zeilenumbruch in die aktuelle Notiz ein.
- Mehrzeiliges Einfügen (Paste)
  - Wenn der eingefügte Text mehrere Zeilen enthält, wird jede nicht-leere Zeile als eigene Notiz gespeichert.

### Review (INBOX Single-Card)
Tastenkürzel sind aktiv, wenn:
- der Tab `Review` offen ist,
- keine Suche aktiv ist,
- kein Eingabefeld fokussiert ist (z. B. Suche/Textarea),
- und kein Stale-To-Do-Review-Modus aktiv ist.

Kürzel:
- `t` -> setzt Status auf `TODO` (To-Do)
- `p` -> setzt Status auf `PROCESS` (Denken)
- `d` -> setzt Status auf `DISCARD` (Verwerfen)
- `s` -> überspringt die aktuelle Notiz (Status bleibt `INBOX`)
- `Esc` -> klappt den Bereich „Heute entschieden“ ein

Hinweise:
- Nach einer Entscheidung springt Review automatisch zur nächsten offenen INBOX-Notiz.
- Für Entscheidungen gibt es ein zeitlich begrenztes Undo.
- Wenn gerade in ein Input-Feld getippt wird, greifen die Review-Shortcuts bewusst nicht.

### Suche
- Volltextsuche über aktive Notizen (Fuse.js, fuzzy)

### Backup / Import
- JSON-Export aller Notizen (inkl. Soft-Deleted)
- Import-Modi:
  - `MERGE` (ID-basiert mit Konfliktlogik)
  - `REPLACE` (lokalen Stand ersetzen)

## Tech Stack

- React + TypeScript + Vite
- IndexedDB (Web API, ohne großes State-Framework)
- Fuse.js für Suche

## Lokale Datenhaltung

### Datenbank
- Name: `leiser-db`
- Store: `notes`
- Indexe:
  - `dayISO`
  - `status`
  - `createdAt`
  - `updatedAt`
  - `status_createdAt`
  - `status_updatedAt`

### Note Modell
```ts
type NoteStatus = "INBOX" | "TODO" | "PROCESS" | "DISCARD" | "ARCHIVE";
type NoteType = "NOTE" | "QUESTION" | "IDEA" | "TASK";

type Note = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  deviceId: string;
  revision: number;
  dayISO: string;
  text: string;
  status: NoteStatus;
  type: NoteType;
};
```

### Prefix-Shortcuts beim Erfassen
- `? Frage ...` -> `type=QUESTION`, `status=INBOX`
- `! Idee ...` -> `type=IDEA`, `status=INBOX`
- `- Aufgabe ...` -> `type=TASK`, `status=TODO`
- Ohne Präfix -> `type=NOTE`, `status=INBOX`

Der Präfix wird **nicht** im gespeicherten Text behalten.

## Backup-Format

```json
{
  "app": "Leiser",
  "schemaVersion": 1,
  "exportedAt": "<ISO>",
  "deviceId": "<device-id>",
  "notes": [ ... ]
}
```

### Merge-Konfliktregel
Bei Import `MERGE` (gleiche `id`):
1. Höhere `revision` gewinnt
2. Bei gleicher `revision`: neueres `updatedAt` gewinnt
3. Bei Gleichstand bleibt lokal erhalten

`deletedAt` wird als Tombstone behandelt und mit importiert/exportiert.

## Entwicklung

### Voraussetzungen
- Node.js 20+
- npm

### Setup
```bash
npm install
```

### Dev Server
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Preview
```bash
npm run preview
```

## Manuelles Testen (Kurz-Check)

1. Braindump: Eintrag erfassen, Reload -> Eintrag bleibt erhalten.
2. Review: INBOX-Notiz entscheiden -> Statuswechsel sichtbar in To-Do/Denken.
3. Stale-Review: Alte TODOs pruefen (`Erledigt` -> `ARCHIVE`).
4. To-Do-Gruppen: Bei >10 To-Dos erscheinen Gruppen + einklappen.
5. Backup: Exportieren, dann Import (`MERGE`/`REPLACE`) testen.
6. Offline: Seite laden, Netzwerk trennen, weiter nutzen.

## Datenschutz

Leiser sendet keine Telemetrie und macht keine externen API-Requests fuer Notizdaten.
Alle Inhalte bleiben lokal im Browserprofil.
