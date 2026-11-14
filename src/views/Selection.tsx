import { useEffect, useRef, useState, type ReactNode } from 'react';
import { editMany, redoMany, removeMany } from '../lib/actions';
import { isKey } from '../lib/shortcuts';
import { useStore } from '../lib/store';
import { CATEGORIES } from '../lib/types';
import { Icon, MoreToggle, NoteField, peek, peekOnly, Pill, useAlt, useArmed, usePeeking } from '../ui';
import { getItem } from '../lib/store';
import { savePictures } from '../lib/pictures';
import type { PieceAction } from '../lib/boards';

/** The bar that takes the dock's place while pieces are selected, on every screen. */
function SelectionBar({ n, total, onAll, onClear, panel, children, bar, more }: {
  n: number; total: number; onAll: () => void; onClear: () => void; panel?: ReactNode; children: ReactNode;
  bar?: React.RefObject<HTMLDivElement | null>; more?: ReactNode;
}) {
  return (
    <div className="selbar glass" role="toolbar" aria-label="Selected pieces" ref={bar}>
      {panel}
      <div className="selbar__head">
        <b className="num">{n} selected</b>
        <span>
          {n < total && <button className="small link" onClick={onAll}>select all</button>}
          <button className="small link" onClick={onClear}>clear</button>
          {more}
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
  const bar = useRef<HTMLDivElement>(null);
  const [arming, setArming] = useArmed(bar);
  const [note, setNote] = useState('');
  useEffect(() => { if (!arming) setNote(''); }, [arming]);
  const n = ids.length;
  // Option (⋯ on touch): the alternates. The originals stay up until toggled off or the selection ends.
  const held = useAlt();
  const [more, setMore] = useState(false);
  const alt = held || more;
  const peeking = usePeeking();
  const originals = ids.length > 0 && ids.every((id) => peeking.has(id));
  const key = ids.join();
  useEffect(() => peekOnly(ids), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => peekOnly([]), []);

  useEffect(() => {
    if (!moving) return;
    // Esc closes the panel first, before it clears the selection.
    const k = (e: KeyboardEvent) => { if (isKey(e, 'close')) { e.preventDefault(); setMoving(false); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [moving]);

  const done = () => { setMoving(false); onClear(); };
  // Pieces sorted by hand keep their kind; the rest are looked at again. One note for all of them.
  const redo = () => {
    if (!arming) { setMoving(false); return setArming(true); }
    void redoMany(ids, note.trim() ? { note: note.trim() } : {}, { recheckKind: true });
    setArming(false);
    done();
  };

  const panel = arming ? (
    <div className="selbar__note">
      <NoteField value={note} onChange={setNote} onGo={redo} onCancel={() => setArming(false)} />
    </div>
  ) : moving && (
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
    <SelectionBar n={n} total={total} onAll={onAll} onClear={onClear} panel={panel} bar={bar}
      more={<MoreToggle on={more} onChange={setMore} />}>
      {(alt || originals) && !arming ? (
        <Pill icon="photos" label={originals ? 'cut-outs' : 'originals'} pressed={originals} className="is-alt"
          run={() => peek(ids, !originals)} />
      ) : hasKey && <button className={'pill' + (arming ? ' is-on' : '')} onClick={redo}><Icon name="turn" />{arming ? 'redo ' + n : 'redo'}</button>}
      <button className={'pill' + (moving ? ' is-on' : '')} aria-expanded={moving} onClick={() => { setArming(false); setMoving(!moving); }}>
        move to
      </button>
      <button className="pill" onClick={() => { editMany(ids, { status: 'owned' }, { label: `${n} marked as mine` }); done(); }}>mine</button>
      <button className="pill" onClick={() => { editMany(ids, { status: 'wish' }, { label: `${n} on the wishlist` }); done(); }}>wishlist</button>
      <Pill icon="bin" label="remove" run={() => { removeMany(ids); done(); }} showAlt={alt}
        alt={{ label: 'save pictures', icon: 'share', run: () => void savePictures(ids.flatMap((id) => getItem(id) ?? [])) }} />
    </SelectionBar>
  );
}

/** On the looks page and saved looks: how the selected pieces lie. The same as their keys. */
export function ArrangeSelection({ n, total, onAll, onClear, onAction, copy = false }: {
  n: number; total: number; onAll: () => void; onClear: () => void; onAction: (a: PieceAction) => void; copy?: boolean;
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
