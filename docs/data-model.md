# Datenmodell und IndexedDB

[Zurück zur README](../README.md) · [Backup/Import](backup-import.md) · [Sync](sync.md)

## Note Modell

```ts
type NoteStatus = "INBOX" | "TODO" | "PROCESS" | "DISCARD" | "ARCHIVE";
type NoteType = "NOTE" | "QUESTION" | "IDEA" | "TASK";
type ArchiveBucket = "THINKING" | "TODO";

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
  starred: boolean;
  archiveBucket?: ArchiveBucket | null;
};
```

## IndexedDB

- DB Name: `leiser-db`
- zentrale Stores:
  - `notes`
  - `notes_view`
  - `crdt_docs`
  - `sync_state`
  - `outbox`
  - `inbox_seen`

Wichtige Indexe (notes/notes_view):

- `dayISO`
- `status`
- `createdAt`
- `updatedAt`
- `status_createdAt`
- `status_updatedAt`

## Prefix-Shortcuts beim Erfassen

- `- Aufgabe ...` -> `type=TASK`, `status=TODO`
- ohne Präfix -> `type=NOTE`, `status=INBOX`

Der Präfix wird nicht im gespeicherten Text abgelegt.

Hinweis zur UI:

- Frage/Idee-Typen werden in der Oberfläche bewusst nicht mehr als Badge hervorgehoben.
- Der `TASK`-Typ wird intern weiter verwendet (u. a. für den initialen `TODO`-Status).
