import { useEffect, useState } from 'react';
import { load, useStore } from './lib/store';
import { clearNotice, resume, useStudio } from './lib/studio';
import { Toast } from './ui';
import { Add } from './views/Add';
import { Board } from './views/Board';
import { Closet } from './views/Closet';
import { Focus } from './views/Focus';
import { Looks, PickLook } from './views/Looks';
import { Mix } from './views/Mix';
import { Studio } from './views/Studio';

type Tab = 'closet' | 'mix' | 'looks' | 'studio';

export function App() {
  const ready = useStore((s) => s.ready);
  const nItems = useStore((s) => s.items.length);
  const nLooks = useStore((s) => s.looks.length);
  const studio = useStudio();

  const [tab, setTab] = useState<Tab>('closet');
  const [focus, setFocus] = useState<{ id: string; from: DOMRect | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [board, setBoard] = useState<string | null>(null);
  const [mixWith, setMixWith] = useState<string | null>(null);
  const [toLook, setToLook] = useState<string | null>(null);

  useEffect(() => {
    void load().then(resume);
  }, []);

  if (!ready) return <div className="app" />;

  const covered = !!focus || !!board;

  return (
    <div className="app">
      <nav className={'nav glass' + (covered ? ' is-away' : '')} aria-label="Main">
        {([['closet', nItems], ['mix', 0], ['looks', nLooks], ['studio', 0]] as const).map(([id, n]) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {id}{n > 0 && <sup>({n})</sup>}
          </button>
        ))}
      </nav>

      <Closet hidden={tab !== 'closet'} onAdd={() => setAdding(true)} onOpen={(id, from) => setFocus({ id, from })} />
      {tab === 'mix' && <Mix startWith={mixWith} onSaved={(id) => { setTab('looks'); setBoard(id); }} onAdd={() => setAdding(true)} />}
      {tab === 'looks' && <Looks onOpen={setBoard} />}
      <Studio hidden={tab !== 'studio'} />

      {!covered && studio.left > 0 && (
        <div className="status glass" role="status">
          <i />
          <span>The studio is working on {studio.left} {studio.left === 1 ? 'photo' : 'photos'}</span>
        </div>
      )}
      {!covered && !studio.left && studio.notice && (
        <div className="status glass is-problem" role="alert">
          <i />
          <span>{studio.notice}</span>
          {studio.noticeKind !== 'retry' && <button onClick={() => { clearNotice(); setTab('studio'); }}>Fix</button>}
          <button onClick={clearNotice} aria-label="Dismiss">Hide</button>
        </div>
      )}

      {focus && (
        <Focus
          key={focus.id}
          id={focus.id}
          from={focus.from}
          onClose={() => setFocus(null)}
          onMix={(id) => { setFocus(null); setMixWith(id); setTab('mix'); }}
          onAddToLook={(id) => setToLook(id)}
        />
      )}
      {board && <Board key={board} id={board} onClose={() => setBoard(null)} />}

      <Add open={adding} onClose={() => setAdding(false)} onConnect={() => setTab('studio')} startAs="owned" />
      <PickLook itemId={toLook} onClose={() => setToLook(null)} onOpen={(id) => { setToLook(null); setFocus(null); setTab('looks'); setBoard(id); }} />
      <Toast />
    </div>
  );
}
