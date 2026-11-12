import { useEffect, useRef, useState } from 'react';
import { download, makeBackup, restoreBackup } from '../lib/backup';
import { balance } from '../lib/pollinations';
import { saveSettings, useStore } from '../lib/store';
import { retryRaw, useStudio } from '../lib/studio';
import { MODELS } from '../lib/types';
import { toast } from '../ui';

/** Credits one remake costs with each model, to turn a balance into "about n photos". */
const COST: Record<string, number> = { [MODELS[0].id]: 0.005, [MODELS[1].id]: 0.03 };

export function Studio({ hidden }: { hidden: boolean }) {
  const settings = useStore((s) => s.settings);
  const items = useStore((s) => s.items);
  const studio = useStudio();
  const [key, setKey] = useState(settings.key);
  const [credits, setCredits] = useState<number | null | 'checking' | 'bad'>(null);
  const [working, setWorking] = useState(false);
  const restore = useRef<HTMLInputElement>(null);

  useEffect(() => setKey(settings.key), [settings.key]);

  const check = async (k: string) => {
    if (!k) return setCredits(null);
    setCredits('checking');
    const b = await balance(k);
    setCredits(b === null ? 'bad' : b);
  };
  // Refresh the balance whenever the page is shown or the studio finishes a batch.
  useEffect(() => {
    if (!hidden && settings.key && !studio.left) void check(settings.key);
  }, [hidden, settings.key, studio.left]);

  const connect = async () => {
    const k = key.trim();
    await saveSettings({ key: k });
    if (k) {
      toast('Studio connected');
      retryRaw();
    }
  };

  const waiting = items.filter((i) => i.state === 'raw').length;
  const per = COST[settings.model] ?? 0.005;

  return (
    <div className="page" hidden={hidden}>
      <h1>Studio</h1>
      <p>Every photo you add is remade here as a clean product shot: straight, evenly lit and cut out, so the whole closet matches.</p>

      <section className="block">
        <h2>Connection</h2>
        {settings.key && typeof credits === 'number' && (
          <div className="credit">
            <b>{credits.toFixed(2)}</b>
            <span className="small muted">credits left, about {Math.floor(credits / per)} photos</span>
          </div>
        )}
        {settings.key && credits === 'checking' && <p className="note">Checking the key.</p>}
        {settings.key && credits === 'bad' && (
          <p className="problem" style={{ margin: 0 }}>This key wasn't accepted. Paste it again, or make a new one.</p>
        )}
        <div className="keyrow">
          <label className="field" style={{ flex: 1, minWidth: 0 }}>
            <span>Pollinations key</span>
            <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)}
              placeholder="sk_…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </label>
          <button className="pill is-on" disabled={key.trim() === settings.key} onClick={connect}>
            {settings.key && !key.trim() ? 'disconnect' : 'connect'}
          </button>
        </div>
        {!settings.key && (
          <ol>
            <li>Open <a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer">enter.pollinations.ai</a> and sign in. It's free.</li>
            <li>Create a secret key and claim the starter credits on the Quests page.</li>
            <li>Paste the key here. It stays on this phone.</li>
          </ol>
        )}
      </section>

      <section className="block">
        <h2>How it works on a photo</h2>
        {MODELS.map((m) => (
          <button key={m.id} className="choice" aria-pressed={settings.model === m.id}
            onClick={() => void saveSettings({ model: m.id })}>
            <span>{m.label[0].toUpperCase() + m.label.slice(1)}</span>
            <span className="small muted">{m.hint}</span>
          </button>
        ))}
      </section>

      {waiting > 0 && (
        <section className="block">
          <h2>{waiting} {waiting === 1 ? 'photo is' : 'photos are'} not cleaned yet</h2>
          <div className="rowbtns">
            <button className="pill is-on" disabled={!settings.key || studio.left > 0} onClick={() => { retryRaw(); toast('Sent to the studio'); }}>
              clean {waiting === 1 ? 'it' : 'them'} now
            </button>
          </div>
        </section>
      )}

      <section className="block">
        <h2>Backup</h2>
        <p className="note">
          Your closet lives in this browser on this phone. Save a backup file now and then, and use it to move to a new phone.
        </p>
        <div className="rowbtns">
          <button className="pill" disabled={working || !items.length} onClick={async () => {
            setWorking(true);
            try {
              download(await makeBackup(), `wardrobe-${new Date().toISOString().slice(0, 10)}.zip`);
            } finally {
              setWorking(false);
            }
          }}>save a backup file</button>
          <button className="pill" disabled={working} onClick={() => restore.current?.click()}>restore from a backup</button>
          <input ref={restore} type="file" accept=".zip,application/zip" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (items.length && !confirm('Restoring replaces everything in the closet now. Continue?')) return;
            setWorking(true);
            try {
              const n = await restoreBackup(f);
              toast(`Restored ${n} ${n === 1 ? 'piece' : 'pieces'}`);
            } catch (err) {
              toast(err instanceof Error ? err.message : "Couldn't restore that file.");
            } finally {
              setWorking(false);
            }
          }} />
        </div>
      </section>
    </div>
  );
}
