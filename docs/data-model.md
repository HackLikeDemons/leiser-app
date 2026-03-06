# Datenmodell und IndexedDB

[Zurück zur README](../README.md) · [Backup/Import](backup-import.md) · [Sync](sync.md)

## Note Modell

```ts
type NoteStatus = "INBOX" | "TODO" | "PROCESS" | "DISCARD" | "ARCHIVE";
type NoteType = "NOTE" | "QUESTION" | "IDEA" | "TASK";
type ArchiveBucket = "THINKING" | "TODO";
type ContextTag = "arbeit" | "familie" | "finanzen" | "freunde" | "gesundheit" | "haushalt" | "privat" | "projekt";

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

## IndexedDB

- DB Name: `leiser-db`
- DB Version: `10`
- zentrale Stores:
  - `notes`
  - `notes_view`
  - `crdt_docs`
  - `sync_state`
  - `outbox`
  - `inbox_seen`

## Verschlüsselung "at rest"

- `Note.text` wird vor Persistenz verschlüsselt gespeichert (`enc:v1:<iv>:<ciphertext>`).
- Laufzeitzugriffe (UI, Suche, Listenfunktionen) arbeiten weiterhin mit entschlüsseltem Text.
- `notes`, `notes_view` und `crdt_docs` enthalten den verschlüsselten Text.
- Metadaten bleiben unverschlüsselt, damit Sortierung, Konfliktauflösung und Retention deterministisch bleiben.

Lokale E2EE-Parameter in `localStorage`:

- `leiser-sync-key` (Passphrase / Sync-Key)
- `leiser:e2ee:salt`
- `leiser:e2ee:wrapped-content-key`
- `leiser:e2ee:migrated-v1` (Migrationsmarker)

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

Hinweis zum Sync-Envelope:

- Snapshot-`text` ist verschlüsselt.
- Pairing-Payload enthält optional zusätzlich `wrappedContentKey` (verschlüsselter Content-Key).

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
