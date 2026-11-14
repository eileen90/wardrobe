import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Item } from '../lib/types';
import { Garment, Icon } from '../ui';

/**
 * The pieces to put on, in a glass strip over the dock: one kind or all of them. A tap puts a
 * piece on (or takes it off again); dragged up out of the strip, it lands where it is let go.
 */
export function RailPicker({ kinds, kind, onKind, pool, on, onPick, onDrop, ghostWidth, onClose }: {
  kinds: { id: string; title: string }[];
  /** the kind shown, or 'all' */
  kind: string;
  onKind: (k: string) => void;
  pool: Item[];
  /** items already on the board being worked on */
  on: Set<string>;
  onPick: (item: Item) => void;
  /** a piece carried out of the strip was let go here (client coordinates) */
  onDrop: (item: Item, x: number, y: number) => void;
  /** how wide a piece would be on the board, on screen */
  ghostWidth: (item: Item) => number;
  onClose: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const pull = useRef<{ pid: number; x: number; y: number; out: boolean } | null>(null);
  const pulled = useRef(false);
  const [ghost, setGhost] = useState<{ item: Item; x: number; y: number } | null>(null);

  // Keep a piece that is on in view.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const pullMove = (e: React.PointerEvent, item: Item) => {
    const p = pull.current;
    if (!p || p.pid !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.out) {
      const mouse = e.pointerType === 'mouse';
      // Up and out of the strip; sideways is the strip scrolling.
      if (!(dy < -10 && Math.abs(dy) > Math.abs(dx)) && !(mouse && Math.hypot(dx, dy) > 8)) return;
      p.out = true;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* gone */ }
    }
    setGhost({ item, x: e.clientX, y: e.clientY });
  };
  const pullUp = (e: React.PointerEvent, item: Item) => {
    const p = pull.current;
    pull.current = null;
    if (!p?.out) return;
    setGhost(null);
    pulled.current = true;
    setTimeout(() => { pulled.current = false; }, 60);
    const r = strip.current?.closest('.pick')?.getBoundingClientRect();
    if (e.type !== 'pointerup' || (r && e.clientY > r.top)) return;
    onDrop(item, e.clientX, e.clientY);
  };

  const title = kinds.find((k) => k.id === kind)?.title ?? 'everything';
  return (
    <div className="pick glass" role="dialog" aria-label={`Choose ${title}`}>
      <div className="pick__head">
        <div className="pick__kinds chips is-row">
          <button className="pill is-small" aria-pressed={kind === 'all'} onClick={() => onKind('all')}>everything</button>
          {kinds.map((k) => (
            <button key={k.id} className="pill is-small" aria-pressed={kind === k.id} onClick={() => onKind(k.id)}>{k.title}</button>
          ))}
        </div>
        <button className="pick__close" aria-label="Done" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="pick__strip" ref={strip}>
        {pool.map((it) => (
          <button key={it.id} className="pick__item" aria-current={on.has(it.id)} aria-label={it.name || it.category}
            onClick={() => { if (!pulled.current) onPick(it); }}
            onPointerDown={(e) => { if (e.button === 0) pull.current = { pid: e.pointerId, x: e.clientX, y: e.clientY, out: false }; }}
            onPointerMove={(e) => pullMove(e, it)} onPointerUp={(e) => pullUp(e, it)} onPointerCancel={(e) => pullUp(e, it)}>
            <Garment item={it} small />
            {it.status === 'wish' && <span className="tag">wishlist</span>}
          </button>
        ))}
        {!pool.length && <span className="pick__none small muted">Nothing here yet.</span>}
      </div>
      {ghost && (() => {
        const w = ghostWidth(ghost.item), h = w / (ghost.item.aspect || 1);
        return createPortal(
          <div className="ghost" style={{ width: w, height: h, transform: `translate3d(${ghost.x - w / 2}px, ${ghost.y - h / 2}px, 0)` }}>
            <Garment item={ghost.item} size="full" />
          </div>
        , document.body);
      })()}
    </div>
  );
}
