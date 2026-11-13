import { useEffect, useRef, useState } from 'react';
import { download, makeBackup, restoreBackup } from '../lib/backup';
import { saveSettings, useStore } from '../lib/store';
import { keyChanged, refreshCredits, resume, tryAgain, useStudio } from '../lib/studio';
import { costOf, MODELS } from '../lib/types';
import { toast } from '../ui';

export function Settings({ hidden }: { hidden: boolean }) {
  const settings = useStore((s) => s.settings);
  const items = useStore((s) => s.items);
  const studio = useStudio();
  const [key, setKey] = useState(settings.key);
  const [bad, setBad] = useState(false);
  const [working, setWorking] = useState(false);
  const restore = useRef<HTMLInputElement>(null);

  useEffect(() => setKey(settings.key), [settings.key]);

  // The balance is read whenever this page is shown.
  useEffect(() => {
    if (hidden || !settings.key) return;
    void refreshCredits().then((b) => setBad(b === 'bad'));
  }, [hidden, settings.key]);

  const connect = async (text: string) => {
    const k = text.trim();
    if (k === settings.key) return;
    await saveSettings({ key: k });
    setBad(false);
    if (k) keyChanged();
  };

  const per = costOf(settings.model);
  const waiting = items.filter((i) => i.state === 'queued' || i.state === 'working').length;
  const credits = settings.key ? studio.credits : null;

  return (
    <div className="page" hidden={hidden}>
      <h1>Settings</h1>

      <section className="block">
        <h2>Studio</h2>
        {credits !== null && (
          <div className="credit">
            <b>{Math.floor(credits / per)}</b>
            <span className="small muted">photos left<br />{credits.toFixed(3)} credits</span>
          </div>
        )}
        {(studio.hold === 'credits' || (credits !== null && credits < per)) && (
          <p className="note">
            {waiting > 0 && `${waiting} ${waiting === 1 ? 'photo is' : 'photos are'} waiting and will finish on their own once there are credits. `}
            Credits don't refill by themselves: earn them on the{' '}
            <a href="https://enter.pollinations.ai/quests" target="_blank" rel="noreferrer">Quests page</a> or top up there.
          </p>
        )}
        {(bad || studio.hold === 'key') && <p className="problem">This key wasn't accepted. Paste it again, or make a new one.</p>}
        <label className="field">
          <span>Pollinations key</span>
          <input className="input" type="password" value={key} placeholder="sk_…" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
            onPaste={(e) => { const t = e.clipboardData.getData('text').trim(); if (t) { e.preventDefault(); setKey(t); void connect(t); } }}
            onBlur={() => void connect(key)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </label>
        {!settings.key && (
          <p className="note">
            Sign in at <a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer">enter.pollinations.ai</a>, create a secret key and paste it here.
            It stays on this device.
          </p>
        )}
      </section>

      <section className="block">
        <h2>Picture quality</h2>
        <div className="choices">
          {MODELS.map((m) => (
            <button key={m.id} className="choice" aria-pressed={settings.model === m.id}
              onClick={() => void saveSettings({ model: m.id }).then(tryAgain)}>
              <span>{m.label}</span>
              <span className="small muted">{m.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Backup</h2>
        <p className="note">Everything lives in this browser only. A backup file moves it to another device.</p>
        <div className="rowbtns">
          <button className="pill" disabled={working || !items.length} onClick={async () => {
            setWorking(true);
            try {
              download(await makeBackup(), `wardrobe-${new Date().toISOString().slice(0, 10)}.zip`);
            } finally {
              setWorking(false);
            }
          }}>save a backup</button>
          <button className="pill" disabled={working} onClick={() => restore.current?.click()}>restore a backup</button>
          <input ref={restore} type="file" accept=".zip,application/zip" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (items.length && !confirm('Restoring replaces everything in the closet now. Continue?')) return;
            setWorking(true);
            try {
              const n = await restoreBackup(f);
              resume();
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
