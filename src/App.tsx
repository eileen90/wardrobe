import { useEffect, useRef, useState } from 'react';
import { stopStudio } from './lib/actions';
import { undoLast, useLastStep } from './lib/history';
import { cancelFetching, takeTransfer } from './lib/intake';
import { load, useStore } from './lib/store';
import { resume, tryAgain, useStudio } from './lib/studio';
import { dismissToast, Icon, Toast, useToasting } from './ui';
import { Add, tell } from './views/Add';
import { Board } from './views/Board';
import { Closet } from './views/Closet';
import { Focus } from './views/Focus';
import { Looks, PickLook } from './views/Looks';
import { Settings } from './views/Settings';

type Tab = 'closet' | 'looks' | 'settings';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(t.tagName);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function App() {
  const ready = useStore((s) => s.ready);
  const nItems = useStore((s) => s.items.length);
  const nLooks = useStore((s) => s.looks.length);
  const studio = useStudio();
  const toasting = useToasting();
  const lastStep = useLastStep();

  const [tab, setTab] = useState<Tab>('closet');
  const [focus, setFocus] = useState<{ id: string; from: DOMRect | null; sequence: string[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [board, setBoard] = useState<string | null>(null);
  const [mixWith, setMixWith] = useState<string | null>(null);
  const [toLook, setToLook] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [quiet, setQuiet] = useState<string | null>(null);

  useEffect(() => {
    void load().then(resume);
  }, []);

  // Pictures and links are taken wherever they land: pasted or dropped, on any screen.
  const depth = useRef(0);
  useEffect(() => {
    const carries = (e: DragEvent) => {
      const t = e.dataTransfer?.types ?? [];
      return t.includes('Files') || t.includes('text/uri-list') || t.includes('text/html');
    };
    const paste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      void takeTransfer(e.clipboardData).then(tell);
    };
    const enter = (e: DragEvent) => { if (carries(e)) { depth.current++; setDropping(true); } };
    const leave = () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDropping(false); };
    const over = (e: DragEvent) => { if (carries(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; } };
    const drop = (e: DragEvent) => {
      depth.current = 0;
      setDropping(false);
      if (!carries(e)) return;
      e.preventDefault();
      void takeTransfer(e.dataTransfer).then(tell);
    };
    // ⌘Z / Ctrl+Z takes back the last thing done, anywhere a board isn't open (boards keep their own).
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !document.querySelector('.board')) {
        e.preventDefault();
        void undoLast();
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('paste', paste);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('paste', paste);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!ready) return <div className="app" />;

  const covered = !!focus || !!board;
  const openBoard = (id: string) => { dismissToast(); setToLook(null); setFocus(null); setTab('looks'); setBoard(id); };

  // One quiet line about what the studio is up to. Nothing here needs doing, except a bad key.
  const n = studio.left;
  const line =
    studio.hold === 'key' && n ? { text: 'The studio key was not accepted', act: 'Fix', run: () => setTab('settings') }
    : studio.hold === 'credits' && n ? { text: `${plural(n, 'photo')} waiting for credits`, act: 'Top up', run: () => setTab('settings') }
    : studio.hold === 'offline' && n ? { text: `Offline. ${plural(n, 'photo')} will finish once you're back`, act: 'Retry', run: tryAgain }
    : studio.hold === 'busy' && n ? { text: `The studio is busy. ${plural(n, 'photo')} will finish shortly`, act: 'Retry', run: tryAgain }
    : studio.free && n ? { text: `Out of credits. Cleaning ${plural(n, 'photo')} with the free backup`, act: 'Top up', run: () => setTab('settings') }
    : n ? { text: `Cleaning ${plural(n, 'photo')}`, act: 'Stop', run: () => void stopStudio() }
    : studio.fetching ? { text: 'Getting the picture', act: 'Cancel', run: cancelFetching }
    : null;
  const held = !!studio.hold && n > 0;

  return (
    <div className="app">
      <nav className={'nav glass' + (covered ? ' is-away' : '')} aria-label="Main">
        <button aria-current={tab === 'closet' ? 'page' : undefined} onClick={() => setTab('closet')}>
          closet{nItems > 0 && <sup>{nItems}</sup>}
        </button>
        <button aria-current={tab === 'looks' ? 'page' : undefined} onClick={() => setTab('looks')}>
          looks{nLooks > 0 && <sup>{nLooks}</sup>}
        </button>
        {lastStep && (
          <button className="nav__icon" aria-label={`Undo: ${lastStep}`} title={`Undo: ${lastStep}`} onClick={() => void undoLast()}>
            <Icon name="undo" />
          </button>
        )}
        <button className="nav__icon" aria-label="Settings" aria-current={tab === 'settings' ? 'page' : undefined}
          onClick={() => setTab('settings')}><Icon name="gear" /></button>
      </nav>

      <Closet hidden={tab !== 'closet'} onAdd={() => setAdding(true)}
        onOpen={(id, from, sequence) => setFocus({ id, from, sequence })} />
      <Looks hidden={tab !== 'looks'} active={tab === 'looks' && !covered && !adding && !toLook}
        startWith={mixWith} onOpen={openBoard} onAdd={() => setAdding(true)} />
      <Settings hidden={tab !== 'settings'} />

      {!covered && !toasting && tab !== 'settings' && line && quiet !== line.text && (
        <div className={'status glass' + (held ? ' is-held' : '')} role="status">
          <i />
          <span>{line.text}</span>
          {line.act && <button onClick={line.run}>{line.act}</button>}
          {held && <button onClick={() => setQuiet(line.text)} aria-label="Hide"><Icon name="x" /></button>}
        </div>
      )}

      {focus && (
        <Focus
          id={focus.id}
          from={focus.from}
          sequence={focus.sequence}
          onGo={(id) => setFocus({ ...focus, id })}
          onClose={() => setFocus(null)}
          onMix={(id) => { setFocus(null); setMixWith(id); setTab('looks'); }}
          onAddToLook={(id) => setToLook(id)}
        />
      )}
      {board && <Board key={board} id={board} onClose={() => setBoard(null)} />}

      <Add open={adding} onClose={() => setAdding(false)} />
      <PickLook itemId={toLook} onClose={() => setToLook(null)} onOpen={openBoard} />
      <Toast />
      <div className={'dropzone' + (dropping ? ' is-on' : '')} aria-hidden="true"><span>Drop to add to your closet</span></div>
    </div>
  );
}
