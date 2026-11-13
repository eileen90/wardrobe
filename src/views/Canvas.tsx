/**
 * One canvas for every place pieces lie: the closet floor, the looks page and saved boards.
 * A gesture means the same thing on each of them:
 *
 *   click            open the piece                 drag            move it
 *   resize gesture   drag up bigger, down smaller    select / range  pick pieces
 *   pinch, ⌘ wheel   zoom around the pointer         wheel, drag     pan
 *
 * and, with pieces selected, the keys from shortcuts.ts. The canvas only reports what was done;
 * the screen that owns the pieces decides what it means and records it in the history.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { bounds, frame, toWorld, union, zoomAround, type Box, type Insets, type Rect, type View } from '../lib/canvas';
import { isKey, isPointer } from '../lib/shortcuts';
import type { Item } from '../lib/types';
import { Garment } from '../ui';

export interface CanvasPiece { id: string; item: Item; box: Box; flip?: boolean }
export type CanvasAction = 'remove' | 'forward' | 'backward' | 'flip' | 'duplicate';
export interface CanvasApi {
  fit: (smooth?: boolean) => void;
  /** a world point on screen, relative to the canvas */
  toScreen: (x: number, y: number) => { x: number; y: number };
  toWorld: (sx: number, sy: number) => { x: number; y: number };
  el: () => HTMLDivElement | null;
}
export interface HudState { hover: boolean; selected: boolean; lifted: boolean }

const place = (b: Box) =>
  `translate3d(${(b.cx - b.w / 2).toFixed(2)}px, ${(b.cy - b.h / 2).toFixed(2)}px, 0) rotate(${b.rot.toFixed(2)}deg)`;

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

type Gesture =
  | { kind: 'press'; pid: number; id: string; sx: number; sy: number; touch: boolean; lift?: ReturnType<typeof setTimeout>; hold?: ReturnType<typeof setTimeout> }
  | { kind: 'drag'; pid: number; id: string; ids: string[]; sx: number; sy: number; dx: number; dy: number }
  | { kind: 'resize'; pid: number; ids: string[]; sy: number; k: number }
  | { kind: 'pan'; pid: number; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'pinch'; d0: number; z0: number; wx: number; wy: number };

export function Canvas(props: {
  pieces: CanvasPiece[];
  sel: Set<string>;
  onSel: (next: Set<string>) => void;
  /** reading order, for selecting a range */
  order?: string[];
  /** false while something else has the keyboard */
  active: boolean;
  /** room the chrome takes along each edge, kept clear when framing */
  insets: Insets;
  /** framing happens again whenever this changes */
  fitKey?: unknown;
  /** closest framing, and the zoom below which framing shows the top instead of everything */
  maxFitZ?: number;
  minFitZ?: number;
  /** a sheet of paper under the pieces, at the world origin */
  paper?: { w: number; h: number; color: string };
  /** use the full-size pictures */
  full?: boolean;
  onOpen: (id: string, rect: DOMRect) => void;
  /** pieces were moved by (dx, dy) world units; `keyed` for arrow-key nudges */
  onMove: (ids: string[], dx: number, dy: number, keyed: boolean) => void;
  /** a piece is being carried: where it would be now (null when put down) */
  onDrag?: (ids: string[], dx: number, dy: number) => void;
  onResize: (ids: string[], k: number, keyed: boolean) => void;
  onAction?: (a: CanvasAction, ids: string[]) => void;
  /** world-space layers under and over the pieces */
  under?: ReactNode;
  over?: ReactNode;
  /** screen-space controls drawn for a piece */
  hud?: (p: CanvasPiece, at: { x: number; y: number; w: number; h: number }, s: HudState) => ReactNode;
  /** extra marks on a piece (tags) */
  decorate?: (p: CanvasPiece) => ReactNode;
  /** something besides pieces under the pointer was clicked */
  onEmpty?: () => void;
  api?: MutableRefObject<CanvasApi | null>;
  className?: string;
  children?: ReactNode;
}) {
  const { pieces, sel } = props;
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ z: 1, x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0 });
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string[]>([]);
  const hoverOff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const anchor = useRef<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<Gesture | null>(null);
  const live = useRef(props);
  live.current = props;
  const tickPending = useRef(false);

  const els = useRef(new Map<string, HTMLElement>());
  const boxOf = (id: string) => live.current.pieces.find((p) => p.id === id)?.box;

  /* ----- the view ----- */
  const apply = (v: View, smooth = false) => {
    view.current = v;
    const w = world.current, r = root.current;
    if (!w || !r) return;
    if (smooth) {
      w.classList.add('is-easing');
      setTimeout(() => w.classList.remove('is-easing'), 460);
    }
    w.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.z})`;
    r.style.setProperty('--zi', String(Math.min(3, Math.max(1, 1 / v.z))));
    if (live.current.hud && !tickPending.current) {
      tickPending.current = true;
      requestAnimationFrame(() => { tickPending.current = false; setTick((t) => t + 1); });
    }
  };
  const fit = (smooth = false) => {
    const P = live.current;
    const { w, h } = size.current;
    if (!w || !h) return;
    let r: Rect | null = bounds(P.pieces.map((p) => p.box));
    if (P.paper) r = union(r, { x0: 0, y0: 0, x1: P.paper.w, y1: P.paper.h });
    if (!r) return;
    apply(frame(r, w, h, P.insets, P.maxFitZ ?? 1, P.minFitZ), smooth);
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  if (props.api) {
    props.api.current = {
      fit,
      toScreen: (x, y) => ({ x: x * view.current.z + view.current.x, y: y * view.current.z + view.current.y }),
      toWorld: (sx, sy) => toWorld(view.current, sx, sy),
      el: () => root.current,
    };
  }

  // Frame everything once there is room to, and again when asked.
  const framed = useRef(false);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const first = !size.current.w;
      size.current = { w: el.clientWidth, h: el.clientHeight };
      if (first || !framed.current) { framed.current = live.current.pieces.length > 0 || !!live.current.paper; fit(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastKey = useRef(props.fitKey);
  useLayoutEffect(() => {
    if (!size.current.w) return;
    if (!framed.current && (pieces.length || props.paper)) { framed.current = true; fit(); return; }
    if (lastKey.current !== props.fitKey) { lastKey.current = props.fitKey; fit(true); }
  });

  /* ----- selecting ----- */
  const toggle = (id: string) => {
    const n = new Set(live.current.sel);
    if (!n.delete(id)) n.add(id);
    anchor.current = id;
    live.current.onSel(n);
  };
  const range = (id: string) => {
    const P = live.current;
    const order = P.order ?? P.pieces.map((p) => p.id);
    const a = anchor.current ? order.indexOf(anchor.current) : -1;
    const b = order.indexOf(id);
    if (a < 0 || b < 0) return toggle(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    P.onSel(new Set([...P.sel, ...order.slice(lo, hi + 1)]));
  };

  /* ----- carrying and resizing: drawn straight onto the pieces until they are put down ----- */
  const draw = (ids: string[], f: (b: Box) => { b: Box; s: number }) => {
    for (const id of ids) {
      const el = els.current.get(id), b = boxOf(id);
      if (!el || !b) continue;
      const r = f(b);
      el.style.transform = place(r.b) + (r.s === 1 ? '' : ` scale(${r.s.toFixed(4)})`);
    }
  };
  const restore = (ids: string[]) => {
    for (const id of ids) {
      const el = els.current.get(id), b = boxOf(id);
      if (el && b) el.style.transform = place(b);
    }
  };
  const lift = () => {
    const c = g.current;
    if (c?.kind !== 'press') return;
    clearTimeout(c.lift);
    const P = live.current;
    const ids = P.sel.has(c.id) && P.sel.size > 1 ? [...P.sel].filter((x) => els.current.has(x)) : [c.id];
    g.current = { kind: 'drag', pid: c.pid, id: c.id, ids, sx: c.sx, sy: c.sy, dx: 0, dy: 0 };
    if (c.touch) navigator.vibrate?.(8);
    setLifted(ids);
    setHover(null);
  };
  const longPress = () => {
    const c = g.current;
    if (!c || (c.kind !== 'press' && c.kind !== 'drag')) return;
    if (c.kind === 'drag' && Math.hypot(c.dx, c.dy) * view.current.z > 8) return;
    const id = c.id;
    if (c.kind === 'drag') { restore(c.ids); setLifted([]); }
    else clearTimeout(c.lift);
    g.current = null;
    navigator.vibrate?.(12);
    toggle(id);
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-hud], button, input, a, label')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    try { root.current!.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (pointers.current.size === 2) {
      // Two fingers: the view itself is pinched; whatever one finger was doing stops.
      const c = g.current;
      if (c?.kind === 'press') { clearTimeout(c.lift); clearTimeout(c.hold); }
      if (c?.kind === 'drag') { restore(c.ids); setLifted([]); }
      if (c?.kind === 'resize') restore(c.ids);
      const [a, b] = [...pointers.current.values()];
      const w = toWorld(view.current, (a.x + b.x) / 2, (a.y + b.y) / 2);
      g.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: view.current.z, wx: w.x, wy: w.y };
      return;
    }
    if (pointers.current.size > 2) return;
    const id = t.closest<HTMLElement>('[data-pid]')?.dataset.pid;
    if (id) {
      if (isPointer(e, 'select')) { g.current = null; toggle(id); return; }
      if (isPointer(e, 'selectRange')) { g.current = null; range(id); return; }
      if (isPointer(e, 'resize')) {
        const P = live.current;
        const ids = P.sel.has(id) && P.sel.size > 1 ? [...P.sel] : [id];
        g.current = { kind: 'resize', pid: e.pointerId, ids, sy: at.y, k: 1 };
        setLifted(ids);
        return;
      }
      const touch = e.pointerType !== 'mouse';
      const c: Gesture = { kind: 'press', pid: e.pointerId, id, sx: at.x, sy: at.y, touch };
      // A finger rests on a piece for a moment before it lifts, so the floor can still be panned.
      if (touch) { c.lift = setTimeout(lift, 240); c.hold = setTimeout(longPress, 480); }
      g.current = c;
      return;
    }
    g.current = { kind: 'pan', pid: e.pointerId, sx: at.x, sy: at.y, vx: view.current.x, vy: view.current.y, moved: false };
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const P = live.current;
    if (e.pointerType === 'mouse' && !pointers.current.size) {
      // Holding the resize keys over a piece shows that it can be resized.
      root.current?.classList.toggle('is-resizing-key', isPointer(e, 'resize'));
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    const c = g.current;
    if (!c) return;
    if (c.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const v = zoomAround({ z: c.z0, x: 0, y: 0 }, c.z0 * (d / c.d0), 0, 0);
      apply({ z: v.z, x: (a.x + b.x) / 2 - c.wx * v.z, y: (a.y + b.y) / 2 - c.wy * v.z });
      return;
    }
    if (c.pid !== e.pointerId) return;
    if (c.kind === 'press') {
      const far = Math.hypot(at.x - c.sx, at.y - c.sy);
      if (c.touch) {
        if (far > 8) {
          // That was a pan, not a pick-up.
          clearTimeout(c.lift); clearTimeout(c.hold);
          g.current = { kind: 'pan', pid: c.pid, sx: c.sx, sy: c.sy, vx: view.current.x, vy: view.current.y, moved: true };
          move(e);
        }
      } else if (far > 4) { lift(); move(e); }
      return;
    }
    if (c.kind === 'drag') {
      const z = view.current.z;
      c.dx = (at.x - c.sx) / z; c.dy = (at.y - c.sy) / z;
      draw(c.ids, (b) => ({ b: { ...b, cx: b.cx + c.dx, cy: b.cy + c.dy }, s: 1.04 }));
      P.onDrag?.(c.ids, c.dx, c.dy);
      return;
    }
    if (c.kind === 'resize') {
      // Up is bigger, down is smaller, around each piece's centre.
      c.k = Math.min(4, Math.max(0.25, Math.exp(-(at.y - c.sy) / 180)));
      draw(c.ids, (b) => ({ b, s: c.k }));
      return;
    }
    if (c.kind === 'pan') {
      if (!c.moved && Math.hypot(at.x - c.sx, at.y - c.sy) < 4) return;
      c.moved = true;
      root.current?.classList.add('is-panning');
      apply({ ...view.current, x: c.vx + at.x - c.sx, y: c.vy + at.y - c.sy });
    }
  };

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const cancelled = e.type === 'pointercancel';
    const P = live.current;
    const c = g.current;
    if (!c) return;
    if (c.kind === 'pinch') { if (pointers.current.size < 2) g.current = null; return; }
    if (c.pid !== e.pointerId) return;
    g.current = null;
    root.current?.classList.remove('is-panning');
    if (c.kind === 'press') {
      clearTimeout(c.lift); clearTimeout(c.hold);
      if (cancelled) return;
      // On a phone, once something is selected a tap adds to it.
      if (c.touch && P.sel.size) return toggle(c.id);
      const el = els.current.get(c.id);
      if (el) P.onOpen(c.id, el.getBoundingClientRect());
      return;
    }
    if (c.kind === 'drag') {
      setLifted([]);
      P.onDrag?.([], 0, 0);
      restore(c.ids);
      if (cancelled) return;
      if (Math.hypot(c.dx, c.dy) * view.current.z > 2) {
        settle(c.ids);
        P.onMove(c.ids, c.dx, c.dy, false);
      } else if (e.pointerType !== 'mouse') {
        // Held a moment and let go without moving: still a tap.
        if (P.sel.size) toggle(c.id);
        else { const el = els.current.get(c.id); if (el) P.onOpen(c.id, el.getBoundingClientRect()); }
      }
      return;
    }
    if (c.kind === 'resize') {
      setLifted([]);
      restore(c.ids);
      if (!cancelled && Math.abs(c.k - 1) > 0.01) { settle(c.ids); P.onResize(c.ids, c.k, false); }
      return;
    }
    if (c.kind === 'pan' && !c.moved && !cancelled) {
      if (P.sel.size) P.onSel(new Set());
      P.onEmpty?.();
    }
  };
  /** A piece put down glides the last bit into place instead of jumping. */
  const settle = (ids: string[]) => {
    for (const id of ids) {
      const el = els.current.get(id);
      if (!el) continue;
      el.classList.add('is-settling');
      setTimeout(() => el.classList.remove('is-settling'), 320);
    }
  };

  /* ----- wheel and trackpad: pan, and zoom with ⌘ or a pinch ----- */
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      // A trackpad pinch arrives as a wheel with ctrlKey set, on every browser.
      if (e.ctrlKey || e.metaKey) {
        const v = view.current;
        apply(zoomAround(v, v.z * Math.exp(-e.deltaY * k * (e.ctrlKey ? 0.01 : 0.003)), e.clientX - r.left, e.clientY - r.top));
      } else {
        apply({ ...view.current, x: view.current.x - e.deltaX * k, y: view.current.y - e.deltaY * k });
      }
    };
    // Safari reports a trackpad pinch as gesture events instead.
    let g0 = 1;
    const gs = (e: Event) => { e.preventDefault(); g0 = view.current.z; };
    const gc = (e: Event) => {
      e.preventDefault();
      if (pointers.current.size) return;
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const r = el.getBoundingClientRect();
      apply(zoomAround(view.current, g0 * ge.scale, ge.clientX - r.left, ge.clientY - r.top));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gs);
    el.addEventListener('gesturechange', gc);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', gs);
      el.removeEventListener('gesturechange', gc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- keys ----- */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const P = live.current;
      if (!P.active || e.defaultPrevented || typing(e.target)) return;
      // A sheet or a piece's page on top has the keyboard; so does a board over a page.
      if (document.querySelector('.sheet, .focus') || (!P.paper && document.querySelector('.board'))) return;
      root.current?.classList.toggle('is-resizing-key', isPointer(e, 'resize'));
      const ids = [...P.sel].filter((id) => P.pieces.some((p) => p.id === id));
      if (isKey(e, 'selectAll')) { e.preventDefault(); P.onSel(new Set(P.pieces.map((p) => p.id))); return; }
      if (isKey(e, 'fit')) { e.preventDefault(); fit(true); return; }
      if (!ids.length) return;
      if (isKey(e, 'close')) { e.preventDefault(); P.onSel(new Set()); return; }
      const nudge = 10 / view.current.z;
      if (isKey(e, 'nudge')) {
        e.preventDefault();
        const d = { arrowleft: [-nudge, 0], arrowright: [nudge, 0], arrowup: [0, -nudge], arrowdown: [0, nudge] }[e.key.toLowerCase()];
        if (d) P.onMove(ids, d[0], d[1], true);
        return;
      }
      if (isKey(e, 'grow')) { e.preventDefault(); P.onResize(ids, 1.06, true); return; }
      if (isKey(e, 'shrink')) { e.preventDefault(); P.onResize(ids, 1 / 1.06, true); return; }
      const acts: CanvasAction[] = ['remove', 'forward', 'backward', 'flip', 'duplicate'];
      for (const a of acts) {
        if (isKey(e, a) && P.onAction) { e.preventDefault(); P.onAction(a, ids); return; }
      }
    };
    const kup = (e: KeyboardEvent) => root.current?.classList.toggle('is-resizing-key', isPointer(e, 'resize'));
    window.addEventListener('keydown', k);
    window.addEventListener('keyup', kup);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', kup); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const v = view.current;
  const hoverOn = (id: string) => { clearTimeout(hoverOff.current); if (!g.current) setHover(id); };
  const hoverOut = () => { clearTimeout(hoverOff.current); hoverOff.current = setTimeout(() => setHover(null), 260); };

  return (
    <div
      ref={root}
      className={'canvas' + (props.className ? ' ' + props.className : '') + (sel.size ? ' is-selecting' : '') + (lifted.length ? ' is-carrying' : '')}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('[data-pid], [data-hud]')) fit(true); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={world} className="canvas__world" style={{ transform: `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.z})` }}>
        {props.paper && <div className="canvas__paper" style={{ width: props.paper.w, height: props.paper.h, background: props.paper.color }} />}
        {props.under}
        {pieces.map((p) => {
          const b = p.box;
          const on = sel.has(p.id);
          return (
            <div
              key={p.id}
              data-pid={p.id}
              ref={(el) => { if (el) els.current.set(p.id, el); else els.current.delete(p.id); }}
              className={'piece' + (on ? ' is-selected' : '') + (lifted.includes(p.id) ? ' is-lifted' : '')}
              role="button"
              aria-label={p.item.name || p.item.category}
              aria-pressed={sel.size ? on : undefined}
              style={{ width: b.w, height: b.h, transform: place(b), zIndex: lifted.includes(p.id) ? 9999 : b.z, ['--unrot' as string]: `${-b.rot}deg` }}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') hoverOn(p.id); }}
              onPointerLeave={(e) => { if (e.pointerType === 'mouse') hoverOut(); }}
            >
              <div className="piece__in">
                <div className="piece__pic" style={p.flip ? { transform: 'scaleX(-1)' } : undefined}>
                  <Garment item={p.item} size={props.full ? 'full' : 'thumb'} small={!props.full && b.w * v.z < 150} />
                </div>
                {props.decorate?.(p)}
              </div>
            </div>
          );
        })}
        {props.over}
      </div>
      {props.hud && (
        <div className="canvas__hud">
          {pieces.map((p) => {
            const b = p.box;
            const s: HudState = { hover: hover === p.id, selected: sel.has(p.id), lifted: lifted.includes(p.id) };
            const node = props.hud!(p, { x: (b.cx - b.w / 2) * v.z + v.x, y: (b.cy - b.h / 2) * v.z + v.y, w: b.w * v.z, h: b.h * v.z }, s);
            return node ? (
              <div key={p.id} data-hud onPointerEnter={() => hoverOn(p.id)} onPointerLeave={hoverOut}>{node}</div>
            ) : null;
          })}
        </div>
      )}
      {props.children}
    </div>
  );
}
