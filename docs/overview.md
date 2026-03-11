# Produktüberblick

[Zurück zur README](../README.md)

Leiser hilft dir im Alltag einen freien Kopf zu behalten: Memos festhalten, später ordnen und in konkrete nächste Schritte übertragen.

Offline-first, ohne Ballast, mit optionalem verschlüsseltem Sync über deine Geräte.

Die App hat vier Arbeitsbereiche:

- Erfassen
- Inbox
- Memos
- Machen

Die App ist bewusst minimal:

- Offline-first
- lokale Speicherung in IndexedDB
- keine Telemetrie
- optionaler Sync über Supabase (ohne klassisches Login)
- Datenbereich für Backup/Sync/Pairing über `...` im Header
- keine Demo-Daten-Seeding-Funktion im aktiven Produktpfad

## Technische Leitplanken

- Offline-first bleibt der Standard: Notizen und UI-Zustand funktionieren ohne Netzwerk.
- Persistenzkritische Browser-Zugriffe laufen defensiv, damit Privacy-Modi oder blockiertes Storage nicht sofort zu Laufzeitfehlern führen.
- Selten genutzte Pfade wie Pairing-QR, Kamera-Scanner, Backup-Import/-Export und die Sync-Engine werden lazy geladen, damit der Erststart klein bleibt.
- Der Service Worker cached nur den App-Shell-Kern vor; große CRDT-/Sync-Chunks werden zur Laufzeit nachgeladen statt aggressiv precached.

## Navigationspunkte

- [Flows und Tabs](flows.md)
- [Tastenkürzel](shortcuts.md)
- [Datenmodell](data-model.md)
- [Backup/Import](backup-import.md)
- [Sync](sync.md)

## Prinzip

1. Memos schnell erfassen (`Erfassen`)
2. Inbox entscheiden (`Inbox`)
3. Themen vertiefen (`Memos`)
4. Nächste Schritte umsetzen (`Machen`)
