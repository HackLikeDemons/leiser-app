# AGENTS.md

## Zweck

Diese Datei gibt Codex projektlokale Arbeitsregeln fuer `Leiser`. Ziel ist konsistentes Arbeiten im Repo, stabile Aenderungen und moeglichst wenig generischer Output.

## Projektkontext

- `Leiser` ist eine offline-first React-App fuer Memos, Inbox-Verarbeitung und naechste Schritte.
- Der Kern ist lokal-first: Daten liegen primaer lokal, Sync ist optional.
- Produktsprache und Dokumentation sind Deutsch. Neue Nutzertexte, UI-Texte und Doku standardmaessig auf Deutsch verfassen.
- Architektur laut README:
  - Single-View React App ohne Router
  - IndexedDB als lokaler Datenspeicher
  - optionale Supabase-Sync-Funktionen
  - schwere Nebenpfade werden lazy geladen

## Arbeitsweise fuer Codex

- Vor Aenderungen zuerst vorhandene Doku und betroffene Implementierung lesen statt Muster zu raten.
- Bestehende Produktbegriffe beibehalten, insbesondere `Erfassen`, `Inbox`, `Memos`, `Machen`, `Geraete-Sync`, `Kontexte`.
- Aenderungen bevorzugt klein, gezielt und im bestehenden Stil halten.
- Keine grossen Umstrukturierungen oder Umbenennungen ohne klaren Nutzen fuer Produkt, Wartbarkeit oder Korrektheit.
- Offline-first darf nicht versehentlich verschlechtert werden. Netzwerkzugriffe, eager Prefetching oder neue externe Abhaengigkeiten nur mit guter Begruendung.
- Sync-, Import-/Export- und Datenmodell-Aenderungen mit besonderer Vorsicht behandeln, weil sie leicht Bestandsdaten oder Geraetekonsistenz betreffen.
- Wenn eine Aenderung Nutzerfluss oder Datenmodell beruehrt, relevante Doku in `docs/` mitpruefen und bei Bedarf mitaktualisieren.

## Prioritaeten bei Implementierungen

1. Datenintegritaet und bestehendes Verhalten schuetzen
2. Produktfluss fuer reale Nutzung verbessern
3. Bundle-Groesse und Ladepfade im Blick behalten
4. UI-Polish erst danach

## Code- und UX-Richtlinien

- Bestehende React-/TypeScript-Muster im Repo fortsetzen.
- Keine neuen Libraries einfuehren, wenn das Problem mit vorhandenen Mitteln sauber loesbar ist.
- Accessibility mitdenken: sinnvolle Labels, Tastaturbedienung, Fokusverhalten.
- Keine Demo-, Mock- oder Seed-Logik in produktiven Nutzerpfaden hinterlassen.
- Bei Textaenderungen auf knappe, ruhige, alltagstaugliche Sprache achten. `Leiser` soll leichtgewichtig und unaufdringlich wirken.

## Validierung

- Nach relevanten Codeaenderungen mindestens passende Checks ausfuehren:
  - `npm run lint`
  - `npm run build`
  - bei End-to-End-relevanten Aenderungen: `npm run test:e2e`
- Wenn nicht alles ausgefuehrt werden kann, im Ergebnis klar sagen, was verifiziert wurde und was nicht.

## Wichtige Dateien

- `README.md` fuer Produkt- und Setup-Ueberblick
- `docs/README.md` als Dokumentationsindex
- `docs/overview.md`, `docs/flows.md`, `docs/data-model.md` fuer Produktlogik
- `docs/sync.md`, `docs/sync-e2e-matrix.md`, `SYNC_CONTRACT.md` fuer Sync-bezogene Aenderungen
- `docs/testing.md` fuer Test-Checklisten

## Was Codex vermeiden soll

- Keine Annahmen ueber Sync- oder Datenmodell-Details treffen, wenn sie im Code oder in der Doku nachlesbar sind.
- Keine stillen Verhaltensaenderungen an Persistenz, Migration, Import/Export oder Service Worker einbauen.
- Keine generischen Design-Experimente, die nicht zur bestehenden App-Sprache passen.
- Keine unnoetig ausufernden Refactorings in Tickets, die eigentlich eine punktuelle Aenderung brauchen.
