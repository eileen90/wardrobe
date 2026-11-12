import { useEffect, useMemo, useRef, useState } from 'react';
import { fromClipboard, fromLink, type Imported } from '../lib/importers';
import { useStore } from '../lib/store';
import { addPicture } from '../lib/studio';
import { CATEGORIES, type Category, type Item } from '../lib/types';
import { Icon, Sheet, toast } from '../ui';

interface Shot { blob: Blob; preview: string; url: string }

export function Add({ open, onClose, onConnect, startAs }: {
  open: boolean;
  onClose: () => void;
  onConnect: () => void;
  startAs: Item['status'];
}) {
  const hasKey = useStore((s) => !!s.settings.key);
  const [shots, setShots] = useState<Shot[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [status, setStatus] = useState<Item['status']>(startAs);
  const [name, setName] = useState('');
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  // Start clean every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setShots((old) => { old.forEach((s) => URL.revokeObjectURL(s.preview)); return []; });
    setCategory(null); setStatus(startAs); setName(''); setLinking(false); setLink(''); setError(null); setBusy(false);
  }, [open, startAs]);

  const take = (list: (Blob | Imported)[]) => {
    const next = list.map((x) => {
      const blob = x instanceof Blob ? x : x.blob;
      return { blob, preview: URL.createObjectURL(blob), url: x instanceof Blob ? '' : x.url };
    });
    if (next.length) setShots((s) => [...s, ...next]);
  };
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    take([...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)));
    e.target.value = '';
  };

  const useLink = async (text: string) => {
    setBusy(true); setError(null);
    try {
      const got = await fromLink(text);
      take([got]);
      if (got.name) setName(got.name);
      setStatus('wish');
      setLinking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that link.");
    } finally {
      setBusy(false);
    }
  };
  const paste = async () => {
    setError(null);
    try {
      const got = await fromClipboard();
      if (!got) return setError('Nothing to paste. Copy a picture or a link first.');
      if (typeof got === 'string') { setLink(got); return void useLink(got); }
      take([got]);
      setLinking(false);
    } catch {
      setError('This browser blocked pasting. Type the link in instead.');
    }
  };

  const add = async () => {
    if (!category || !shots.length) return;
    setBusy(true);
    let done = 0;
    for (const s of shots) {
      try {
        await addPicture(s.blob, { category, status, name: shots.length === 1 ? name.trim() : '', url: s.url });
        done++;
      } catch (e) {
        setError(e instanceof Error ? e.message : "One picture couldn't be opened.");
      }
    }
    setBusy(false);
    if (done) {
      toast(done === 1 ? 'Sent to the studio' : `${done} pieces sent to the studio`);
      onClose();
    }
  };

  const title = useMemo(() => (shots.length ? 'What is it?' : 'Add a piece'), [shots.length]);

  return (
    <Sheet open={open} onClose={onClose} label="Add a piece">
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
      <input ref={library} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      <div className="sheet__head"><h2>{title}</h2></div>

      {!shots.length && !linking && (
        <div className="ways">
          <button className="way" onClick={() => camera.current?.click()}><Icon name="camera" />Take a photo</button>
          <button className="way" onClick={() => library.current?.click()}><Icon name="photos" />Choose from photos</button>
          <button className="way" onClick={() => setLinking(true)}><Icon name="link" />Paste a picture or a link</button>
        </div>
      )}

      {!shots.length && linking && (
        <>
          <label className="field">
            <span>Link to a picture or a shop page</span>
            <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://"
              inputMode="url" autoCapitalize="off" autoCorrect="off" autoFocus
              onKeyDown={(e) => e.key === 'Enter' && link.trim() && void useLink(link)} />
          </label>
          <div className="rowbtns">
            <button className="pill" onClick={paste} disabled={busy}>paste from clipboard</button>
            <button className="pill is-quiet" onClick={() => { setLinking(false); setError(null); }}>back</button>
          </div>
          <button className="go is-wide" disabled={busy || !link.trim()} onClick={() => void useLink(link)}>
            {busy ? 'Fetching the picture' : 'Get the picture'}
          </button>
        </>
      )}

      {shots.length > 0 && (
        <>
          <div className="shots">
            {shots.map((s) => <img key={s.preview} src={s.preview} alt="" />)}
          </div>
          <div className="field">
            <span>Kind</span>
            <div className="chips">
              {CATEGORIES.map((c) => (
                <button key={c.id} className="pill" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>It is</span>
            <div className="chips">
              <button className="pill" aria-pressed={status === 'owned'} onClick={() => setStatus('owned')}>mine</button>
              <button className="pill" aria-pressed={status === 'wish'} onClick={() => setStatus('wish')}>on my wishlist</button>
            </div>
          </div>
          {shots.length === 1 && (
            <label className="field">
              <span>Name, if you like. It also helps the studio know what to look for.</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Grey hoodie" enterKeyHint="done" />
            </label>
          )}
          {!hasKey && (
            <p className="note">
              The studio isn't connected, so only pictures on a plain background get cut out; other photos stay as they are.{' '}
              <button onClick={() => { onClose(); onConnect(); }}>Connect the studio</button>
            </p>
          )}
          <button className="go is-wide" disabled={!category || busy} onClick={add}>
            {busy ? 'Adding' : !category ? 'Pick a kind first' : shots.length === 1 ? 'Add this piece' : `Add ${shots.length} pieces`}
          </button>
        </>
      )}

      {error && <p className="problem" style={{ margin: 0 }}>{error}</p>}
    </Sheet>
  );
}
