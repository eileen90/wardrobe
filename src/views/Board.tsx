import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteLook, step } from '../lib/actions';
import { addPiece, BH, boxOnBoard, BW, widthOn } from '../lib/boards';
import { shareLook } from '../lib/exportBoard';
import { undoLast, useLastStep } from '../lib/history';
import { isKey } from '../lib/shortcuts';
import { removeLook, saveLook, useStore } from '../lib/store';
import { CATEGORIES, PAPERS, uid, type Category, type Item, type Look, type Placed } from '../lib/types';
import { Garment, Icon, Sheet, toast } from '../ui';
import { Canvas, type CanvasAction, type CanvasApi, type CanvasPiece } from './Canvas';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(t.tagName);

/**
 * Change a look's pieces as one step in the history. Shared by saved boards and the looks page,
 * so moving, resizing, layering, flipping and removing mean the same on both.
 */
export function editPieces(pieces: Placed[], a: CanvasAction | 'move' | 'resize', ids: string[], arg: { dx?: number; dy?: number; k?: number } = {}): Placed[] | null {
  const on = new Set(ids);
  switch (a) {
    case 'move':
      return pieces.map((p) => (on.has(p.id) ? { ...p, x: p.x + (arg.dx ?? 0) / BW, y: p.y + (arg.dy ?? 0) / BH, byHand: true } : p));
    case 'resize':
      return pieces.map((p) => (on.has(p.id) ? { ...p, w: Math.min(2, Math.max(0.03, p.w * (arg.k ?? 1))), byHand: true } : p));
    case 'remove':
      return pieces.filter((p) => !on.has(p.id));
    case 'forward':
      return [...pieces.filter((p) => !on.has(p.id)), ...pieces.filter((p) => on.has(p.id))];
    case 'backward':
      return [...pieces.filter((p) => on.has(p.id)), ...pieces.filter((p) => !on.has(p.id))];
    case 'flip':
      return pieces.map((p) => (on.has(p.id) ? { ...p, flip: !p.flip } : p));
    case 'duplicate':
      return [...pieces, ...pieces.filter((p) => on.has(p.id)).map((p) => ({ ...p, id: uid(), x: p.x + 0.05, y: p.y + 0.04 }))];
  }
}
export const LABELS: Record<CanvasAction | 'move' | 'resize', string> = {
  move: 'Moved', resize: 'Resized', remove: 'Removed', forward: 'Brought forward', backward: 'Sent back', flip: 'Flipped', duplicate: 'Copied',
};

/** A saved look, opened on its own on top of everything: a free board with paper. */
export function Board({ id, onClose, onFocus }: {
  id: string;
  onClose: () => void;
  onFocus: (id: string, from: DOMRect, sequence: string[]) => void;
}) {
  const items = useStore((s) => s.items);
  const look = useStore((s) => s.looks.find((l) => l.id === id));
  const lastStep = useLastStep();
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [more, setMore] = useState(false);
  const [name, setName] = useState(look?.name ?? '');
  const api = useRef<CanvasApi | null>(null);
  const live = useRef(look);
  live.current = look;
  useEffect(() => { setName(look?.name ?? ''); }, [look?.name]);

  const commit = (next: Look, label: string, key?: string) => {
    const before = live.current;
    if (!before) return;
    live.current = next;
    void saveLook(next);
    step(label, () => void saveLook(before), { key });
  };
  const edit = (a: CanvasAction | 'move' | 'resize', ids: string[], arg: { dx?: number; dy?: number; k?: number } = {}, key?: string) => {
    const cur = live.current;
    if (!cur) return;
    const pieces = editPieces(cur.pieces, a, ids, arg);
    if (!pieces) return;
    commit({ ...cur, pieces }, LABELS[a], key);
    if (a === 'remove') setSel(new Set());
    if (a === 'duplicate') setSel(new Set(pieces.slice(cur.pieces.length).map((p) => p.id)));
  };

  const close = () => {
    // A board nobody put anything on isn't worth keeping.
    if (live.current && !live.current.pieces.length) removeLook(live.current.id);
    onClose();
  };
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.defaultPrevented || more || document.querySelector('.focus')) return;
    if (typing(e.target)) { if (isKey(e, 'close')) (e.target as HTMLElement).blur(); return; }
    if (isKey(e, 'close')) { e.preventDefault(); close(); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const pieces: CanvasPiece[] = useMemo(() => (look?.pieces ?? []).flatMap((p, z) => {
    const item = items.find((i) => i.id === p.itemId);
    return item ? [{ id: p.id, item, box: boxOnBoard(p, item, z + 1), flip: p.flip }] : [];
  }), [look, items]);

  /* ----- pulling a piece out of the drawer onto the board ----- */
  const pull = useRef<{ pid: number; x: number; y: number; out: boolean } | null>(null);
  const pulled = useRef(false);
  const [ghost, setGhost] = useState<{ item: Item; x: number; y: number } | null>(null);
  const add = (itemId: string, at?: { x: number; y: number }) => {
    const cur = live.current;
    const item = items.find((i) => i.id === itemId);
    if (!cur || !item) return;
    const next = addPiece(cur.pieces, items, item, at);
    commit({ ...cur, pieces: next }, 'Added to the look');
    setSel(new Set([next[next.length - 1].id]));
  };
  const pullMove = (e: React.PointerEvent, item: Item) => {
    const p = pull.current;
    if (!p || p.pid !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.out) {
      const mouse = e.pointerType === 'mouse';
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
    const el = api.current?.el();
    const r = el?.getBoundingClientRect();
    if (e.type !== 'pointerup' || !r || e.clientY < r.top || e.clientY > r.bottom) return;
    const w = api.current!.toWorld(e.clientX - r.left, e.clientY - r.top);
    add(item.id, { x: w.x / BW, y: w.y / BH });
  };

  if (!look) return null;
  const pool = items.filter((i) => i.state === 'ready' && (cat === 'all' || i.category === cat));
  const cats = CATEGORIES.filter((c) => items.some((i) => i.state === 'ready' && i.category === c.id));
  const ghostScale = (() => {
    const el = api.current?.el();
    if (!el) return 1;
    const a = api.current!.toScreen(0, 0), b = api.current!.toScreen(BW, 0);
    return (b.x - a.x) / BW;
  })();

  return (
    <div className="board" role="dialog" aria-modal="true" aria-label={look.name || 'Board'}>
      <div className="board__top">
        <button className="iconbtn" onClick={close} aria-label="Back to looks"><Icon name="back" /></button>
        <input className="board__name" value={name} placeholder="Name this look" enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (live.current && name !== live.current.name) commit({ ...live.current, name }, 'Renamed'); }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <button className="iconbtn" onClick={() => void undoLast()} disabled={!lastStep} aria-label="Undo"><Icon name="undo" /></button>
        <button className="iconbtn" disabled={!look.pieces.length} aria-label="Share as a picture" onClick={async () => {
          const r = await shareLook(look, items);
          if (r === 'saved') toast('Picture saved');
        }}><Icon name="share" /></button>
        <button className="iconbtn" onClick={() => setMore(true)} aria-label="More"><Icon name="more" /></button>
      </div>

      <div className="board__mid">
        <Canvas
          className="is-board"
          api={api}
          full
          pieces={pieces}
          sel={sel}
          onSel={setSel}
          active={!more}
          paper={{ w: BW, h: BH, color: look.paper }}
          insets={{ top: 12, bottom: 12, left: 16, right: 16 }}
          maxFitZ={3}
          onOpen={(pid, rect) => {
            const p = look.pieces.find((x) => x.id === pid);
            if (p) onFocus(p.itemId, rect, look.pieces.map((x) => x.itemId));
          }}
          onMove={(ids, dx, dy, keyed) => edit('move', ids, { dx, dy }, keyed ? 'nudge:' + ids.join() : undefined)}
          onResize={(ids, k, keyed) => edit('resize', ids, { k }, keyed ? 'size:' + ids.join() : undefined)}
          onAction={(a, ids) => edit(a, ids)}
        >
          {!look.pieces.length && <div className="board__hint">Tap a piece below, or drag it up here</div>}
        </Canvas>
      </div>

      <div className="drawer">
        <div className="chips is-row">
          <button className="pill" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>everything</button>
          {cats.map((c) => (
            <button key={c.id} className="pill" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.plural}</button>
          ))}
        </div>
        <div className="drawer__strip">
          {pool.map((i) => (
            <button key={i.id} className="drawer__item" aria-label={`Add ${i.name || 'piece'}`}
              onClick={() => { if (!pulled.current) add(i.id); }}
              onPointerDown={(e) => { if (e.button === 0) pull.current = { pid: e.pointerId, x: e.clientX, y: e.clientY, out: false }; }}
              onPointerMove={(e) => pullMove(e, i)} onPointerUp={(e) => pullUp(e, i)} onPointerCancel={(e) => pullUp(e, i)}>
              <Garment item={i} small />
              {i.status === 'wish' && <span className="tag">wishlist</span>}
            </button>
          ))}
          {!pool.length && <span className="small muted" style={{ padding: '30px 14px' }}>No cleaned pieces here yet.</span>}
        </div>
      </div>

      <Sheet open={more} onClose={() => setMore(false)} label="Board options">
        <div className="sheet__head"><h2>Paper</h2></div>
        <div className="papers">
          {PAPERS.map((c) => (
            <button key={c} style={{ background: c }} aria-pressed={look.paper === c} aria-label={`Paper ${c}`}
              onClick={() => commit({ ...look, paper: c }, 'Paper changed')} />
          ))}
        </div>
        <div className="rowbtns">
          <button className="pill" onClick={() => { deleteLook(look.id); onClose(); }}>
            <Icon name="bin" />delete this look
          </button>
        </div>
      </Sheet>

      {ghost && (() => {
        const w = widthOn(ghost.item, look.pieces, items) * BW * ghostScale, h = w / ghost.item.aspect;
        return (
          <div className="ghost" style={{ width: w, height: h, transform: `translate3d(${ghost.x - w / 2}px, ${ghost.y - h / 2}px, 0)` }}>
            <Garment item={ghost.item} size="full" />
          </div>
        );
      })()}
    </div>
  );
}
