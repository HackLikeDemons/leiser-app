import type { ChangeEvent } from 'react'

type PairingPanelProps = {
  syncPairCode: string | null
  scannerHint: string | null
  syncPairCodeDraft: string
  onShowPairQr: () => void
  onOpenScanner: () => void
  onCopyPairCode: () => void
  onPairCodeDraftChange: (value: string) => void
  onPasteFromClipboard: () => void
  onImportPairCode: () => void
}

export function PairingPanel({
  syncPairCode,
  scannerHint,
  syncPairCodeDraft,
  onShowPairQr,
  onOpenScanner,
  onCopyPairCode,
  onPairCodeDraftChange,
  onPasteFromClipboard,
  onImportPairCode,
}: PairingPanelProps) {
  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onPairCodeDraftChange(event.target.value)
  }

  return (
    <section className="data-card pairing-panel" aria-label="Geräte koppeln">
      <h3>Geräte koppeln</h3>
      <div className="data-actions">
        <button type="button" onClick={onShowPairQr} disabled={!syncPairCode}>
          QR-Code anzeigen
        </button>
        <button type="button" onClick={onOpenScanner}>
          QR scannen
        </button>
      </div>
      <p className="hint">Teile deinen Sync Code nur mit Geräten denen du vertraust.</p>
      {scannerHint ? <p className="hint">{scannerHint}</p> : null}
      {syncPairCode ? (
        <div className="import-panel">
          <p className="hint">Pair Code ist aus Sicherheitsgründen ausgeblendet.</p>
          <p className="hint">Bitte verwahre deinen Sync Code als Backup an einem sicheren Ort, sonst kann der Zugriff auf bestehende Daten verloren gehen.</p>
          <button type="button" onClick={onCopyPairCode}>
            Pair Code kopieren
          </button>
        </div>
      ) : null}
      <div className="import-panel">
        <label className="hint" htmlFor="sync-pair-import">Pair Code einfügen</label>
        <textarea
          id="sync-pair-import"
          value={syncPairCodeDraft}
          onChange={handleDraftChange}
          rows={2}
          placeholder='leiser://pair?... oder {"roomId":"...","token":"..."}'
        />
        <div className="data-actions">
          <button type="button" onClick={onPasteFromClipboard}>
            Aus Zwischenablage
          </button>
          <button type="button" onClick={onImportPairCode} disabled={!syncPairCodeDraft.trim()}>
            Pairing importieren
          </button>
        </div>
      </div>
    </section>
  )
}
