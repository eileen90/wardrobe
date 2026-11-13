import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shareLook } from '../lib/exportBoard';
import { getState, removeLook, saveLook, useStore } from '../lib/store';
import { BOARD_RATIO, CATEGORIES, PAPERS, uid, type Category, type Look, type Placed } from '../lib/types';
import { Garment, Icon, Sheet, toast } from '../ui';
import { placeFresh } from './Looks';

type Gesture =
  | { kind: 'drag'; pid: number; id: string; x: number; y: number; ox: number; oy: number; moved: boolean }
  | { kind: 'pinch'; id: string; d0: number; a0: number; w0: number; r0: number }
  | { kind: 'handle'; pid: number; id: string; d0: number; a0: number; w0: number; r0: number };

const deg = (r: number) => (r * 180) / Math.PI;
/** Turning snaps gently to upright, so pieces are easy to straighten. */
const snap = (r: number) => {
  const n = ((r % 360) + 540) % 360 - 180;
  return Math.abs(n) < 3 ? 0 : n;
};

export function Board({ id, onClose }: { id: string; onClose: () => void }) {
  const items = useStore((s) => s.items);
  const [look, setLook] = useState<Look | undefined>(() => getState().looks.find((l) => l.id === id));
  const [sel, setSel] = useState<string | null>(null);
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [more, setMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [canUndo, setCanUndo] = useState(false);
  const mid = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const live = useRef(look);
  live.current = look;
  const history = useRef<Placed[][]>([]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* ----- saving ----- */
  const flush = () => {
    clearTimeout(saveTimer.current);
    if (live.current) void saveLook(live.current);
  };
  const change = (patch: Partial<Look>, remember = false) => {
    const cur = live.current;
    if (!cur) return;
    if (remember) {
      history.current.push(cur.pieces);
      if (history.current.length > 40) history.current.shift();
      setCanUndo(true);
    }
    const next = { ...cur, ...patch };
    live.current = next;
    setLook(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 400);
  };
  const setPiece = (pid: string, patch: Partial<Placed>) =>
    change({ pieces: live.current!.pieces.map((p) => (p.id === pid ? { ...p, ...patch } : p)) });
  const remember = () => {
    history.current.push(live.current!.pieces);
    if (history.current.length > 40) history.current.shift();
    setCanUndo(true);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    setCanUndo(history.current.length > 0);
    change({ pieces: prev });
    if (sel && !prev.some((p) => p.id === sel)) setSel(null);
  };

  const close = () => {
    flush();
    // A board nobody put anything on isn't worth keeping.
    if (live.current && !live.current.pieces.length) void removeLook(live.current.id);
    onClose();
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  /* ----- sizing the board to the space between the bars ----- */
  useLayoutEffect(() => {
    const el = mid.current;
    if (!el) return;
    const fit = () => {
      const cw = el.clientWidth - 24, ch = el.clientHeight - 12;
      const w = Math.max(120, Math.min(cw, ch * BOARD_RATIO));
      setSize({ w, h: w / BOARD_RATIO });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!look) return null;
  const { w: W, h: H } = size;
  const itemOf = (p: Placed) => items.find((i) => i.id === p.itemId);
  const selected = look.pieces.find((p) => p.id === sel);

  /* ----- touch: one finger moves, two fingers resize and turn ----- */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const two = () => {
    const [a, b] = [...pointers.current.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  const down = (e: React.PointerEvent) => {
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    canvas.current!.setPointerCapture(e.pointerId);
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-piece]')?.dataset.piece ?? null;
    if (pointers.current.size === 2) {
      const target = sel ?? hit;
      const p = live.current!.pieces.find((x) => x.id === target);
      if (p) {
        if (gesture.current?.kind !== 'drag' || !gesture.current.moved) remember();
        const t = two();
        gesture.current = { kind: 'pinch', id: p.id, d0: t.d, a0: t.a, w0: p.w, r0: p.rot };
        setSel(p.id);
      }
      return;
    }
    if (hit) {
      const p = live.current!.pieces.find((x) => x.id === hit)!;
      setSel(hit);
      gesture.current = { kind: 'drag', pid: e.pointerId, id: hit, x: at.x, y: at.y, ox: p.x, oy: p.y, moved: false };
    } else {
      setSel(null);
      gesture.current = null;
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'drag' && g.pid === e.pointerId) {
      if (!g.moved) {
        if (Math.hypot(at.x - g.x, at.y - g.y) < 4) return;
        g.moved = true;
        remember();
      }
      setPiece(g.id, {
        x: Math.min(1.1, Math.max(-0.1, g.ox + (at.x - g.x) / W)),
        y: Math.min(1.1, Math.max(-0.1, g.oy + (at.y - g.y) / H)),
      });
    } else if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const t = two();
      setPiece(g.id, {
        w: Math.min(1.8, Math.max(0.08, g.w0 * (t.d / g.d0))),
        rot: snap(g.r0 + deg(t.a - g.a0)),
      });
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch' && pointers.current.size < 2) gesture.current = null;
    if (g?.kind === 'drag' && g.pid === e.pointerId) gesture.current = null;
  };

  /* ----- the corner handle: resize and turn with one finger ----- */
  const centre = (p: Placed) => ({ x: p.x * W, y: p.y * H });
  const handleDown = (e: React.PointerEvent) => {
    if (!selected) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const c = centre(selected), at = local(e);
    remember();
    gesture.current = {
      kind: 'handle', pid: e.pointerId, id: selected.id,
      d0: Math.hypot(at.x - c.x, at.y - c.y), a0: Math.atan2(at.y - c.y, at.x - c.x),
      w0: selected.w, r0: selected.rot,
    };
  };
  const handleMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g?.kind !== 'handle' || g.pid !== e.pointerId) return;
    const p = live.current!.pieces.find((x) => x.id === g.id);
    if (!p) return;
    const c = centre(p), at = local(e);
    setPiece(g.id, {
      w: Math.min(1.8, Math.max(0.08, g.w0 * (Math.hypot(at.x - c.x, at.y - c.y) / g.d0))),
      rot: snap(g.r0 + deg(Math.atan2(at.y - c.y, at.x - c.x) - g.a0)),
    });
  };
  const handleUp = (e: React.PointerEvent) => {
    if (gesture.current?.kind === 'handle' && gesture.current.pid === e.pointerId) gesture.current = null;
  };

  /* ----- tools ----- */
  const reorder = (toFront: boolean) => {
    if (!selected) return;
    const rest = look.pieces.filter((p) => p.id !== selected.id);
    change({ pieces: toFront ? [...rest, selected] : [selected, ...rest] }, true);
  };
  const add = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const p = placeFresh(item, look.pieces.length);
    change({ pieces: [...look.pieces, p] }, true);
    setSel(p.id);
  };

  let handle: { x: number; y: number } | null = null;
  if (selected && W) {
    const item = itemOf(selected);
    if (item) {
      const w = selected.w * W, h = w / item.aspect, r = (selected.rot * Math.PI) / 180;
      const hx = w / 2 + 6, hy = h / 2 + 6;
      // Kept inside the board so it can always be reached, even for a piece hanging off the edge.
      handle = {
        x: Math.min(W - 18, Math.max(18, selected.x * W + hx * Math.cos(r) - hy * Math.sin(r))),
        y: Math.min(H - 18, Math.max(18, selected.y * H + hx * Math.sin(r) + hy * Math.cos(r))),
      };
    }
  }

  const pool = items.filter((i) => i.state === 'ready' && (cat === 'all' || i.category === cat));
  const cats = CATEGORIES.filter((c) => items.some((i) => i.state === 'ready' && i.category === c.id));

  return (
    <div className="board" role="dialog" aria-modal="true" aria-label={look.name || 'Board'}>
      <div className="board__top">
        <button className="iconbtn" onClick={close} aria-label="Back to looks"><Icon name="back" /></button>
        <input className="board__name" value={look.name} placeholder="Name this look" enterKeyHint="done"
          onChange={(e) => change({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <button className="iconbtn" onClick={undo} disabled={!canUndo} aria-label="Undo"><Icon name="undo" /></button>
        <button className="iconbtn" disabled={!look.pieces.length} aria-label="Share as a picture" onClick={async () => {
          flush();
          const r = await shareLook(look, items);
          if (r === 'saved') toast('Picture saved');
        }}><Icon name="share" /></button>
        <button className="iconbtn" onClick={() => { setConfirmDelete(false); setMore(true); }} aria-label="More"><Icon name="more" /></button>
      </div>

      <div className="board__mid" ref={mid}>
        {W > 0 && (
          <div className="canvas" ref={canvas} style={{ width: W, height: H, background: look.paper }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {look.pieces.map((p) => {
              const item = itemOf(p);
              if (!item) return null;
              const w = p.w * W, h = w / item.aspect;
              return (
                <div key={p.id} data-piece={p.id} className={'placed' + (p.id === sel ? ' is-sel' : '')}
                  style={{
                    width: w, height: h,
                    transform: `translate3d(${p.x * W - w / 2}px, ${p.y * H - h / 2}px, 0) rotate(${p.rot}deg) scaleX(${p.flip ? -1 : 1})`,
                  }}>
                  <Garment item={item} size="full" />
                </div>
              );
            })}
            {handle && (
              <div className="handle" style={{ left: handle.x, top: handle.y }} aria-label="Resize and turn"
                onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleUp}>
                <Icon name="turn" />
              </div>
            )}
            {!look.pieces.length && (
              <div className="row__none" style={{ padding: 40, textAlign: 'center', pointerEvents: 'none' }}>
                Tap a piece below to lay it on the board
              </div>
            )}
          </div>
        )}
      </div>

      <div className="board__tools">
        {selected ? (
          <>
            <button className="pill" onClick={() => reorder(true)}>to front</button>
            <button className="pill" onClick={() => reorder(false)}>to back</button>
            <button className="pill" onClick={() => { remember(); setPiece(selected.id, { flip: !selected.flip }); }}>flip</button>
            <button className="pill" onClick={() => {
              const copy = { ...selected, id: uid(), x: Math.min(0.95, selected.x + 0.07), y: Math.min(0.95, selected.y + 0.05) };
              change({ pieces: [...look.pieces, copy] }, true);
              setSel(copy.id);
            }}>copy</button>
            <button className="pill" onClick={() => {
              change({ pieces: look.pieces.filter((p) => p.id !== selected.id) }, true);
              setSel(null);
            }}>remove</button>
          </>
        ) : (
          look.pieces.length > 0 && <span className="small muted" style={{ alignSelf: 'center' }}>Drag to move. Two fingers resize and turn.</span>
        )}
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
            <button key={i.id} className="drawer__item" onClick={() => add(i.id)} aria-label={`Add ${i.name || 'piece'}`}>
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
              onClick={() => change({ paper: c })} />
          ))}
        </div>
        <div className="rowbtns">
          {confirmDelete
            ? <button className="pill is-danger" onClick={() => { clearTimeout(saveTimer.current); void removeLook(look.id); toast('Look removed'); onClose(); }}>yes, delete this look</button>
            : <button className="pill" onClick={() => setConfirmDelete(true)}>delete this look</button>}
        </div>
      </Sheet>
    </div>
  );
}
