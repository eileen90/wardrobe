import { useEffect, useState } from 'react';
import { editMany, redoMany, removeMany } from '../lib/actions';
import { useStore } from '../lib/store';
import { CATEGORIES, costOf, MODELS, REDO_MODEL } from '../lib/types';
import { Icon } from '../ui';

type Panel = 'redo' | 'move' | null;

/** The bar that takes the dock's place while pieces are selected: one action, one undo step. */
export function SelectionBar({ ids, total, onAll, onClear }: {
  ids: string[]; total: number; onAll: () => void; onClear: () => void;
}) {
  const items = useStore((s) => s.items);
  const hasKey = useStore((s) => !!s.settings.key);
  const [panel, setPanel] = useState<Panel>(null);
  const [model, setModel] = useState(REDO_MODEL);
  const [note, setNote] = useState('');
  const [recheck, setRecheck] = useState(true);
  const n = ids.length;

  useEffect(() => {
    if (!panel) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [panel]);

  const picked = items.filter((i) => ids.includes(i.id));
  const credits = +picked.reduce((t) => t + costOf(model), 0).toFixed(3);
  const byHand = recheck ? picked.filter((i) => i.kindByHand).length : 0;
  const done = () => { setPanel(null); onClear(); };

  const redo = () => {
    void redoMany(ids, { model, note: note.trim() }, { recheckKind: recheck });
    setNote('');
    done();
  };
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);

  return (
    <div className="selbar glass" role="toolbar" aria-label="Selected pieces">
      {panel === 'redo' && (
        <div className="redo selbar__panel">
          <div className="chips is-row" role="group" aria-label="Model">
            {MODELS.map((m) => (
              <button key={m.id} className="pill" aria-pressed={model === m.id} title={m.hint} onClick={() => setModel(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="note">{MODELS.find((m) => m.id === model)?.hint}. {n} {n === 1 ? 'picture' : 'pictures'} ·{' '}
            <b className="num">{credits}</b> credits in all.</p>
          <input className="input" value={note} placeholder="What's wrong? (optional, e.g. sleeves cut off)" aria-label="What's wrong"
            enterKeyHint="go" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && redo()} />
          <button className="pill selbar__switch" role="switch" aria-checked={recheck} aria-pressed={recheck}
            onClick={() => setRecheck(!recheck)}>
            {recheck && <Icon name="check" />}check what each piece is again
          </button>
          {byHand > 0 && <p className="note">{byHand} you sorted yourself will keep their kind.</p>}
          <div className="slip__acts">
            <button className="pill is-on" onClick={redo}><Icon name="turn" />redo {n}</button>
            <button className="pill" onClick={() => setPanel(null)}>not now</button>
          </div>
        </div>
      )}
      {panel === 'move' && (
        <div className="chips is-row selbar__panel" role="group" aria-label="Move to">
          {CATEGORIES.map((c) => (
            <button key={c.id} className="pill"
              onClick={() => {
                editMany(ids, { category: c.id, kindSure: true, kindByHand: true }, { label: `Moved ${n} to ${c.plural}` });
                done();
              }}>{c.label}</button>
          ))}
        </div>
      )}
      <div className="selbar__head">
        <b className="num">{n} selected</b>
        <span>
          {n < total && <button className="small link" onClick={onAll}>select all</button>}
          <button className="small link" onClick={onClear}>clear</button>
        </span>
      </div>
      <div className="selbar__acts">
        {hasKey && (
          <button className={'pill' + (panel === 'redo' ? ' is-on' : '')} aria-expanded={panel === 'redo'} onClick={() => toggle('redo')}>
            <Icon name="turn" />redo
          </button>
        )}
        <button className={'pill' + (panel === 'move' ? ' is-on' : '')} aria-expanded={panel === 'move'} onClick={() => toggle('move')}>
          move to
        </button>
        <button className="pill" onClick={() => { editMany(ids, { status: 'owned' }, { label: `${n} marked as mine` }); done(); }}>mine</button>
        <button className="pill" onClick={() => { editMany(ids, { status: 'wish' }, { label: `${n} on the wishlist` }); done(); }}>wishlist</button>
        <button className="pill" onClick={() => { removeMany(ids); done(); }}><Icon name="bin" />remove</button>
      </div>
    </div>
  );
}
