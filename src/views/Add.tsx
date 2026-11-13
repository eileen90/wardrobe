import { useEffect, useMemo, useRef, useState } from 'react';
import { fromClipboard, fromLink, type Imported } from '../lib/importers';
import { useStore } from '../lib/store';
import { addPicture } from '../lib/studio';
import { CATEGORIES, type Category, type Item } from '../lib/types';
import { Icon, Sheet, toast } from '../ui';

interface Shot { blob: Blob; preview: string; url: string; from: Item['from']; kind: Category | null }

export function Add({ open, onClose, onConnect, startAs }: {
  open: boolean;
  onClose: () => void;
  onConnect: () => void;
  startAs: Item['status'];
}) {
  const hasKey = useStore((s) => !!s.settings.key);
  const [shots, setShots] = useState<Shot[]>([]);
  const [cur, setCur] = useState(0);
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
    setCur(0); setStatus(startAs); setName(''); setLinking(false); setLink(''); setError(null); setBusy(false);
  }, [open, startAs]);

  const take = (list: (Blob | Imported)[]) => {
    const next = list.map((x) => {
      const blob = x instanceof Blob ? x : x.blob;
      return { blob, preview: URL.createObjectURL(blob), url: x instanceof Blob ? '' : x.url, from: x instanceof Blob ? 'photo' as const : 'web' as const, kind: null };
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

  // Each photo gets its own kind; choosing one moves on to the next photo without one.
  const setKind = (kind: Category) => {
    const next = shots.map((s, i) => (i === cur ? { ...s, kind } : s));
    setShots(next);
    const todo = next.findIndex((s, i) => i > cur && !s.kind);
    const wrap = todo >= 0 ? todo : next.findIndex((s) => !s.kind);
    if (wrap >= 0) setTimeout(() => setCur(wrap), 220);
  };
  const missing = shots.filter((s) => !s.kind).length;

  const add = async () => {
    if (missing || !shots.length) return;
    setBusy(true);
    let done = 0;
    for (const s of shots) {
      try {
        await addPicture(s.blob, { category: s.kind!, status, name: shots.length === 1 ? name.trim() : '', url: s.url, from: s.from });
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
            {shots.map((s, i) => (
              <button key={s.preview} className={'shot' + (i === cur ? ' is-cur' : '')} onClick={() => setCur(i)}
                aria-label={`Photo ${i + 1}${s.kind ? ', ' + s.kind : ''}`}>
                <img src={s.preview} alt="" />
                {shots.length > 1 && <span className="small">{s.kind ? CATEGORIES.find((c) => c.id === s.kind)!.label : 'choose'}</span>}
              </button>
            ))}
          </div>
          <div className="field">
            <span>{shots.length > 1 ? `Kind of photo ${cur + 1}` : 'Kind'}</span>
            <div className="chips">
              {CATEGORIES.map((c) => (
                <button key={c.id} className="pill" aria-pressed={shots[cur]?.kind === c.id} onClick={() => setKind(c.id)}>{c.label}</button>
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
          <button className="go is-wide" disabled={missing > 0 || busy} onClick={add}>
            {busy ? 'Adding'
              : missing ? (shots.length === 1 ? 'Pick a kind first' : `${missing} still ${missing === 1 ? 'needs' : 'need'} a kind`)
              : shots.length === 1 ? 'Add this piece' : `Add ${shots.length} pieces`}
          </button>
        </>
      )}

      {error && <p className="problem" style={{ margin: 0 }}>{error}</p>}
    </Sheet>
  );
}
