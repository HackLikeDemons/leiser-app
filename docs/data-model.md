# Datenmodell und IndexedDB

[Zurück zur README](../README.md) · [Backup/Import](backup-import.md) · [Sync](sync.md)

## Note Modell

```ts
type NoteStatus = "INBOX" | "TODO" | "PROCESS" | "DISCARD" | "ARCHIVE";
type NoteType = "NOTE" | "QUESTION" | "IDEA" | "TASK";
type ArchiveBucket = "THINKING" | "TODO";
type ContextTag = string; // sichtbarer Bereichsname, z. B. "Arbeit", "Weiterbildung"

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
  context?: ContextTag;
};
```

Hinweis zu `context`:
- Bereiche sind über das Kontextmenü konfigurierbar (`Bereiche bearbeiten`).
- Gespeichert wird derselbe Name, der auch in der UI angezeigt wird.
- Beim Löschen eines Bereichs werden bestehende Zuordnungen auf `Ohne Bereich` gesetzt.
- Nach Backup-Import werden unbekannte/nicht konfigurierte Bereiche auf `Ohne Bereich` gesetzt.

## IndexedDB

- DB Name: `leiser-db`
- zentrale Stores:
  - `notes`
  - `notes_view`
  - `crdt_docs`
  - `sync_state`
  - `outbox`
  - `inbox_seen`

## Sync-relevante State-Infos

`sync_state` enthält pro Raum u. a.:

- `roomId`
- `isEnabled`
- `syncToken`
- `lastPulledSeq`
- `lastPushedAt`
- `lastError`

`outbox` enthält unsent/sent Changes:

- `changeId`
- `roomId`
- `noteId`
- `bytes`
- `createdAt`
- `sentAt`
- `attemptCount`

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
