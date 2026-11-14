import { useEffect, useRef, useState } from 'react';
import { download, makeBackup, restoreBackup } from '../lib/backup';
import { useCloud } from '../lib/cloud';
import { TOP_UP_URL } from '../lib/pollinations';
import { isDone } from '../lib/shortcuts';
import { saveSettings, useStore } from '../lib/store';
import { keyChanged, refreshCredits, resume, tryAgain, useStudio } from '../lib/studio';
import { costOf, MODELS, REDO_MODEL } from '../lib/types';
import { record } from '../lib/history';
import { toast } from '../ui';
import { Account, ResetPassword } from './Account';
import { ShortcutList } from './Shortcuts';

/** Which image model to use: the same choice for new photos and for a redo. */
function ModelChoice({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return (
    <>
      <div className="chips">
        {MODELS.map((m) => (
          <button key={m.id} className="pill" aria-pressed={value === m.id} onClick={() => onPick(m.id)}>{m.label}</button>
        ))}
      </div>
      <p className="note">{MODELS.find((m) => m.id === value)?.hint}</p>
    </>
  );
}

/** A phone without a keyboard has no use for shortcuts. */
const touchOnly = matchMedia('(hover: none) and (pointer: coarse)').matches;

export function Settings({ hidden }: { hidden: boolean }) {
  const settings = useStore((s) => s.settings);
  const items = useStore((s) => s.items);
  const studio = useStudio();
  const account = useCloud().email;
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
  const credits = settings.key ? studio.credits : null;

  return (
    <>
    <ResetPassword />
    <div className="page" hidden={hidden}>
      <h1>Settings</h1>

      <Account />

      <section className="block">
        <h2>Studio</h2>
        {credits !== null && (
          <div className="credit">
            <b>{Math.floor(credits / per)}</b>
            <span className="small muted">photos left<br />{credits.toFixed(3)} credits</span>
          </div>
        )}
        {(studio.hold === 'credits' || (credits !== null && credits < per * 10)) && (
          <p className="note">
            {credits !== null && credits >= per ? 'Running low on credits. ' : 'Out of credits. Photos wait until there are more. '}
            <a href={TOP_UP_URL} target="_blank" rel="noreferrer">Top up</a>: $5 covers about{' '}
            {Math.floor(5 / per).toLocaleString()} photos.
          </p>
        )}
        {(bad || studio.hold === 'key') && <p className="problem">This key wasn't accepted. Paste it again, or make a new one.</p>}
        <label className="field">
          <span>Pollinations key</span>
          <input className="input" type="password" value={key} placeholder="sk_…" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
            onPaste={(e) => { const t = e.clipboardData.getData('text').trim(); if (t) { e.preventDefault(); setKey(t); void connect(t); } }}
            onBlur={() => void connect(key)}
            onKeyDown={(e) => isDone(e) && e.currentTarget.blur()} />
        </label>
        {!settings.key && (
          <p className="note">
            Sign in at <a href="https://enter.pollinations.ai" target="_blank" rel="noreferrer">enter.pollinations.ai</a>, create a secret key and paste it here.
            It stays on this device. The <a href="https://enter.pollinations.ai/quests" target="_blank" rel="noreferrer">Quests page</a> gives
            a few one-time starter credits; after that, <a href={TOP_UP_URL} target="_blank" rel="noreferrer">top up</a> (a quick photo costs half a cent).
          </p>
        )}
      </section>

      <section className="block">
        <h2>New photos</h2>
        <ModelChoice value={settings.model} onPick={(model) => void saveSettings({ model }).then(tryAgain)} />
      </section>

      <section className="block">
        <h2>Redo</h2>
        <ModelChoice value={settings.redoModel ?? REDO_MODEL} onPick={(redoModel) => void saveSettings({ redoModel })} />
      </section>

      {!touchOnly && (
        <section className="block" id="shortcuts">
          <h2>Shortcuts</h2>
          <ShortcutList edit />
        </section>
      )}

      <section className="block">
        <h2>Backup</h2>
        <p className="note">
          {account
            ? 'A backup file is a copy of everything, to keep wherever you like.'
            : 'Everything lives in this browser only. A backup file moves it to another device.'}
        </p>
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
            setWorking(true);
            try {
              // Restoring replaces everything at once; Undo puts back what was here.
              const before = items.length ? await makeBackup() : null;
              const n = await restoreBackup(f);
              resume();
              const said = `Restored ${n} ${n === 1 ? 'piece' : 'pieces'}`;
              if (before) record(said, async () => { await restoreBackup(before); resume(); });
              else toast(said);
            } catch (err) {
              toast(err instanceof Error ? err.message : "Couldn't restore that file.");
            } finally {
              setWorking(false);
            }
          }} />
        </div>
      </section>

      <p className="credit-line">
        <a href="https://pollinations.ai/?ref=badge" target="_blank" rel="noreferrer">
          <img src="https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg"
            alt="Made with pollinations.ai" height="22" />
        </a>
      </p>
    </div>
    </>
  );
}
