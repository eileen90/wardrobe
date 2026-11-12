import { useEffect, useRef, useState } from 'react';
import { exportBackup, importBackup } from './backup';
import { wipeAll } from './db';
import { downloadBlob } from './exportBoard';
import { reload, useStore } from './store';
import { Icon, Sheet, say } from './ui';

export default function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, boards } = useStore();
  const [used, setUsed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmWipe(false);
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setUsed(`${(e.usage / 1e6).toFixed(0)} MB`);
    });
  }, [open]);

  async function backup() {
    setBusy(true);
    try {
      const blob = await exportBackup();
      downloadBlob(blob, `wardrobe-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch {
      say("Couldn't create the backup.");
    } finally {
      setBusy(false);
    }
  }
  async function restore(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const n = await importBackup(f);
      say(`Restored ${n} piece${n === 1 ? '' : 's'}.`);
    } catch (e) {
      say(e instanceof Error ? e.message : 'Restore failed.', 5000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} label="Settings">
      <div className="sheet-body">
        <h2 className="sheet-title">Your wardrobe</h2>
        <p className="hint">
          {items.length} pieces and {boards.length} outfits live on this device only
          {used ? ` (${used} used)` : ''}. Save a backup now and then so nothing is lost if you
          change phones or clear your browser.
        </p>
        <div className="stack">
          <button className="btn wide" disabled={busy || !items.length} onClick={backup}>
            <Icon name="download" size={18} /> Save a backup file
          </button>
          <button className="btn wide" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} /> Restore from a backup
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            void restore(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <h3 className="sub-title">Put it on your home screen</h3>
        <p className="hint">
          iPhone: open this page in Safari, tap Share, then “Add to Home Screen”. Android: open the
          browser menu and tap “Install app”. It then opens full-screen and works offline.
        </p>
        <div className="danger-row">
          {confirmWipe ? (
            <button
              className="btn danger"
              onClick={async () => {
                await wipeAll();
                await reload();
                onClose();
              }}
            >
              Yes, erase everything
            </button>
          ) : (
            <button className="btn ghost" disabled={!items.length && !boards.length} onClick={() => setConfirmWipe(true)}>
              <Icon name="trash" size={16} /> Erase everything
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
