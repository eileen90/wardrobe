import { useEffect, useState } from 'react';
import { editMany, redoMany, removeMany } from '../lib/actions';
import { isKey } from '../lib/shortcuts';
import { useStore } from '../lib/store';
import { CATEGORIES } from '../lib/types';
import { Icon } from '../ui';

type Panel = 'move' | null;

/** The bar that takes the dock's place while pieces are selected: one action, one undo step. */
export function SelectionBar({ ids, total, onAll, onClear }: {
  ids: string[]; total: number; onAll: () => void; onClear: () => void;
}) {
  const hasKey = useStore((s) => !!s.settings.key);
  const [panel, setPanel] = useState<Panel>(null);
  const n = ids.length;

  useEffect(() => {
    if (!panel) return;
    // Esc closes the panel first, before it clears the selection.
    const k = (e: KeyboardEvent) => { if (isKey(e, 'close')) { e.preventDefault(); setPanel(null); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [panel]);

  const done = () => { setPanel(null); onClear(); };

  // Pieces sorted by hand keep their kind; the rest are looked at again.
  const redo = () => {
    void redoMany(ids, {}, { recheckKind: true });
    done();
  };
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);

  return (
    <div className="selbar glass" role="toolbar" aria-label="Selected pieces">
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
          <button className="pill" onClick={redo}>
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
