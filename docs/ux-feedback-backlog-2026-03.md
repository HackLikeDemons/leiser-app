# UX Backlog aus Nutzerfeedback (März 2026)

Quelle: direktes Nutzerfeedback zur Task-Erstellung, Statuswechseln und Bedienbarkeit der Aktionen.

## Ziel

- Modell und Begriffe schnell verständlich machen.
- Aktionen ohne Ausprobieren erkennbar machen.
- Zustandswechsel konsistent und reversibel machen.
- Bearbeiten bestehender Tasks ermöglichen.

## P0 (sofort)

### 1) Statusmodell vereinheitlichen (inkl. Rückweg aus `Machen` nach `Denken`)

Problem:
- Nutzer versteht nicht, warum ein Wechsel von `Machen` zurück zu `Denken` fehlt.
- Archivieren wirkt je Bereich unterschiedlich verfügbar.

Umsetzung:
- Einheitliche Aktion `Verschieben nach…` für `Denken` und `Machen` einführen.
- Wechsel `TODO -> PROCESS` erlauben (heutige Lücke schließen).
- Archivieren als Aktion in beiden Bereichen konsistent anbieten.
- Übergangsregeln im UI kurz erklären (Tooltip/Hint), falls einzelne Wege absichtlich ausgeschlossen bleiben.

Akzeptanzkriterien:
- Für jede offene Note in `Denken` und `Machen` gibt es Zugriff auf mindestens: `In Denken`, `In Machen`, `Archivieren` (falls im gleichen Zielzustand: Aktion deaktiviert/versteckt, aber Modell bleibt nachvollziehbar).
- Ein Task kann ohne Workaround von `Machen` nach `Denken` verschoben werden.
- Archivieren ist in beiden Bereichen im offenen Zustand erreichbar.
- Es gibt keine widersprüchlichen Zustandswege zwischen UI und Dokumentation.

Betroffene Bereiche:
- `src/App.tsx` (Row-Actions, Status-Handler, Labels)
- `docs/flows.md` (Regeln aktualisieren)

### 2) Aktionen mit sichtbarer Bedeutung versehen (Icons + Beschriftung/Kontextmenü)

Problem:
- Reine Icons sind nicht intuitiv; Nutzer muss ausprobieren.

Umsetzung:
- Auf Desktop: Icon + kurzer Text (`Denken`, `Machen`, `Archiv`, `Zurück`) oder klarer Tooltip.
- Auf Touch: Long-Press oder `...`-Kontextmenü pro Note mit textuellen Einträgen.
- Einheitliche `aria-label` + `title` + Fokuszustände sicherstellen.

Akzeptanzkriterien:
- Keine primäre Note-Aktion ist nur über ein unlabeled Icon erklärbar.
- Hover zeigt Text-Hinweis, Touch zeigt gleichwertige textuelle Alternative.
- Alle Aktionsbuttons sind per Screenreader eindeutig unterscheidbar.

Betroffene Bereiche:
- `src/App.tsx` (Buttons in `Review`, `Thinking`, `Todo`, Archive-Listen)
- `src/styles/global.css` (Button-Layout/Responsive)

### 3) Task-Bearbeitung ermöglichen

Problem:
- Nach Erstellung können Tasks nicht korrigiert werden.

Umsetzung:
- Aktion `Bearbeiten` je Note (Inline oder Modal) für mindestens Text + Bereich.
- Speichern/Abbrechen, Escape, Enter-Verhalten definieren.
- Bestehende Undo/Sync-Pfade beibehalten.

Akzeptanzkriterien:
- Nutzer kann bestehenden Task-Text ändern und speichern.
- Bereich kann im Bearbeiten-Modus geändert werden.
- Änderungen sind nach Reload vorhanden (IndexedDB/Supabase-Sync kompatibel).
- Bei Fehler erscheint klare Fehlermeldung, ursprünglicher Inhalt bleibt erhalten.

Betroffene Bereiche:
- `src/App.tsx` (Note-Row UI + Update-Handler)
- `src/lib/dbNotes.ts` (Update-Pfade prüfen)
- ggf. `tests/e2e/` (neuer Edit-Flow)

## P1 (nächster Schritt)

### 4) Begriffe `Ordnen`, `Denken`, `Machen` selbsterklärend machen

Problem:
- Tab-Namen allein erklären den Unterschied nicht.

Umsetzung:
- Untertitel/Helpertext pro Tab ergänzen (1 Satz, aktionsorientiert).
- Optional: verständlichere Alternativlabels testen (A/B oder kurzer Usability-Check).

Akzeptanzkriterien:
- Jeder Tab zeigt eine Kurzbeschreibung direkt im View (`was hier zu tun ist`).
- Leere Zustände verwenden dieselbe Begriffswelt wie Tab und Aktionen.

Betroffene Bereiche:
- `src/App.tsx` (`FlowHero`-Titel/Untertitel, Empty States)
- `docs/overview.md`, `docs/flows.md`

### 5) `#bereich`-Verhalten transparent machen

Problem:
- `#bereich` wird aus Fließtext entfernt; Effekt ist nicht erkennbar.

Umsetzung:
- Entweder Hashtag im Text behalten, oder bei Erfassung klar anzeigen: „`#bereich` wurde als Bereich gesetzt“.
- Entscheidung dokumentieren (Produktregel).

Akzeptanzkriterien:
- Nutzer bekommt beim Speichern unmittelbares Feedback zur Bereichszuordnung.
- Kein stilles „Verschwinden“ ohne sichtbare Rückmeldung.
- Verhalten ist in Hilfe/Hint und Doku beschrieben.

Betroffene Bereiche:
- `src/App.tsx` (`parseBraindumpEntryForContext`, Capture-Feedback)
- `docs/flows.md`

## P2 (Polish)

### 6) Vereinheitlichtes Aktionsmenü pro Note

Umsetzung:
- Optionales `...`-Menü pro Note als zentrale Aktionsfläche (insb. mobil).
- Primäraktion bleibt als schneller Shortcut sichtbar (z. B. `Erledigt` in `Machen`).

Akzeptanzkriterien:
- Alle Note-Aktionen sind zusätzlich über ein textuelles Menü erreichbar.
- Mobile Bedienbarkeit verbessert sich ohne Verlust schneller Desktop-Shortcuts.

## Reihenfolge für Umsetzung

1. P0.1 Statusmodell
2. P0.2 Beschriftete Aktionen
3. P0.3 Bearbeiten
4. P1.5 `#bereich`-Feedback
5. P1.4 Begriffs-Klarheit
6. P2.6 Aktionsmenü-Polish

## Messbare Erfolgskriterien

- Weniger Rückfragen zu „Was bedeutet dieser Tab?“ in Nutzertests.
- Weniger Fehlklicks auf Note-Aktionen (qualitativ beobachtet oder per Session-Notes).
- Nutzer kann im Test ohne Hilfe:
  - Task erstellen
  - zwischen `Denken` und `Machen` in beide Richtungen bewegen
  - Task bearbeiten
  - archivieren
