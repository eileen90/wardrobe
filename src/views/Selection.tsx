import { useEffect, useState, type ReactNode } from 'react';
import { editMany, redoMany, removeMany } from '../lib/actions';
import { isKey } from '../lib/shortcuts';
import { useStore } from '../lib/store';
import { CATEGORIES } from '../lib/types';
import { Icon } from '../ui';
import type { CanvasAction } from './Canvas';

/** The bar that takes the dock's place while pieces are selected, on every screen. */
function SelectionBar({ n, total, onAll, onClear, panel, children }: {
  n: number; total: number; onAll: () => void; onClear: () => void; panel?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="selbar glass" role="toolbar" aria-label="Selected pieces">
      {panel}
      <div className="selbar__head">
        <b className="num">{n} selected</b>
        <span>
          {n < total && <button className="small link" onClick={onAll}>select all</button>}
          <button className="small link" onClick={onClear}>clear</button>
        </span>
      </div>
      <div className="selbar__acts">{children}</div>
    </div>
  );
}

/** In the closet: what is done to the pieces themselves. One action, one undo step. */
export function ClosetSelection({ ids, total, onAll, onClear }: {
  ids: string[]; total: number; onAll: () => void; onClear: () => void;
}) {
  const hasKey = useStore((s) => !!s.settings.key);
  const [moving, setMoving] = useState(false);
  const n = ids.length;

  useEffect(() => {
    if (!moving) return;
    // Esc closes the panel first, before it clears the selection.
    const k = (e: KeyboardEvent) => { if (isKey(e, 'close')) { e.preventDefault(); setMoving(false); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [moving]);

  const done = () => { setMoving(false); onClear(); };
  // Pieces sorted by hand keep their kind; the rest are looked at again.
  const redo = () => {
    void redoMany(ids, {}, { recheckKind: true });
    done();
  };

  const panel = moving && (
    <div className="chips selbar__panel" role="group" aria-label="Move to">
      {CATEGORIES.map((c) => (
        <button key={c.id} className="pill"
          onClick={() => {
            editMany(ids, { category: c.id, kindSure: true, kindByHand: true }, { label: `Moved ${n} to ${c.plural}` });
            done();
          }}>{c.label}</button>
      ))}
    </div>
  );
  return (
    <SelectionBar n={n} total={total} onAll={onAll} onClear={onClear} panel={panel}>
      {hasKey && <button className="pill" onClick={redo}><Icon name="turn" />redo</button>}
      <button className={'pill' + (moving ? ' is-on' : '')} aria-expanded={moving} onClick={() => setMoving(!moving)}>
        move to
      </button>
      <button className="pill" onClick={() => { editMany(ids, { status: 'owned' }, { label: `${n} marked as mine` }); done(); }}>mine</button>
      <button className="pill" onClick={() => { editMany(ids, { status: 'wish' }, { label: `${n} on the wishlist` }); done(); }}>wishlist</button>
      <button className="pill" onClick={() => { removeMany(ids); done(); }}><Icon name="bin" />remove</button>
    </SelectionBar>
  );
}

/** On the looks page and saved looks: how the selected pieces lie. The same as their keys. */
export function ArrangeSelection({ n, total, onAll, onClear, onAction, copy = false }: {
  n: number; total: number; onAll: () => void; onClear: () => void; onAction: (a: CanvasAction) => void; copy?: boolean;
}) {
  return (
    <SelectionBar n={n} total={total} onAll={onAll} onClear={onClear}>
      <button className="pill" onClick={() => onAction('forward')}><Icon name="front" />forward</button>
      <button className="pill" onClick={() => onAction('backward')}><Icon name="behind" />back</button>
      <button className="pill" onClick={() => onAction('flip')}><Icon name="flip" />flip</button>
      {copy && <button className="pill" onClick={() => onAction('duplicate')}><Icon name="copy" />copy</button>}
      <button className="pill" onClick={() => onAction('remove')}><Icon name="bin" />remove</button>
    </SelectionBar>
  );
}
