/**
 * One canvas for every place pieces lie: the closet floor and the looks board. A gesture means
 * the same thing on each of them:
 *
 *   click, tap        select it: a frame with handles and a small toolbar
 *   double-click/tap  open the piece (an area on the looks board: go into it)
 *   drag              move it at once, selected or not; it snaps to its neighbours' edges
 *   corner handle     bigger or smaller        round handle, two-finger twist   turn it
 *   select / range    add pieces to the selection (long press on a phone)
 *   resize gesture    drag up bigger, down smaller
 *   pinch, ⌘ wheel    zoom around the pointer   wheel, drag on the floor        pan
 *
 * and, with pieces selected, the keys from shortcuts.ts. The canvas only reports what was done;
 * the screen that owns the pieces decides what it means and records it in the history.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { PieceAction } from '../lib/boards';
import { bounds, frame, toWorld, union, zoomAround, type Box, type Insets, type Rect, type View } from '../lib/canvas';
import { arrowOf, covered, hint, isKey, isPointer } from '../lib/shortcuts';
import type { Item } from '../lib/types';
import { Garment, Icon } from '../ui';

export interface CanvasPiece { id: string; item: Item; box: Box; flip?: boolean }
/**
 * Something besides a piece lying on the canvas (a saved look's area on the looks board): it is
 * selected, carried, resized and opened like a piece, but draws itself and never turns.
 */
export interface CanvasArea { id: string; box: Box; node: ReactNode; className?: string }
export interface CanvasApi {
  /** frame what is being worked on; with `again`, everything once that is already in view */
  fit: (smooth?: boolean, again?: boolean) => void;
  frame: (r: Rect, smooth?: boolean) => void;
  view: () => View;
  size: () => { w: number; h: number };
  /** a world point on screen, relative to the canvas */
  toScreen: (x: number, y: number) => { x: number; y: number };
  toWorld: (sx: number, sy: number) => { x: number; y: number };
  el: () => HTMLDivElement | null;
}
interface HudState { hover: boolean; selected: boolean; lifted: boolean; /** some piece is under the pointer */ anyHover: boolean }
/** A change made with the handles or two fingers: grown by k and turned by deg about (px, py). */
export interface Transform { k: number; deg: number; px: number; py: number }
/** Where the selection is on screen, for placing controls beside it. */
export interface SelBox { x: number; y: number; w: number; h: number; rot: number }

type Thing = { id: string; box: Box; item?: Item; flip?: boolean; node?: ReactNode; className?: string; area: boolean };

const place = (b: Box) =>
  `translate3d(${(b.cx - b.w / 2).toFixed(2)}px, ${(b.cy - b.h / 2).toFixed(2)}px, 0) rotate(${b.rot.toFixed(2)}deg)`;
/** The upright rectangle a turned box takes up. */
const aabb = (b: Box): Rect => {
  const t = (b.rot * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const w = b.w * c + b.h * s, h = b.w * s + b.h * c;
  return { x0: b.cx - w / 2, y0: b.cy - h / 2, x1: b.cx + w / 2, y1: b.cy + h / 2 };
};
const rad = (d: number) => (d * Math.PI) / 180;
/** A box moved, grown and turned about a pivot, as the handles and a twist preview it. */
const transformed = (b: Box, t: Transform): Box => {
  const c = Math.cos(rad(t.deg)), s = Math.sin(rad(t.deg));
  const x = b.cx - t.px, y = b.cy - t.py;
  return { ...b, cx: t.px + (x * c - y * s) * t.k, cy: t.py + (x * s + y * c) * t.k, rot: b.rot + t.deg };
};
/** Turning settles on upright and on the quarter turns when it comes close. */
const settleTurn = (rot0: number, deg: number, fine: boolean) => {
  if (fine) return Math.round((rot0 + deg) / 15) * 15 - rot0;
  const r = rot0 + deg, q = Math.round(r / 90) * 90;
  return Math.abs(r - q) < 4 ? q - rot0 : deg;
};

type Gesture =
  | { kind: 'press'; pid: number; id: string; sx: number; sy: number; touch: boolean; picked: boolean; lift?: ReturnType<typeof setTimeout>; hold?: ReturnType<typeof setTimeout> }
  | { kind: 'drag'; pid: number; id: string; ids: string[]; sx: number; sy: number; dx: number; dy: number; touch: boolean; others: Rect[] }
  | { kind: 'resize'; pid: number; ids: string[]; sy: number; k: number }
  | { kind: 'handle'; pid: number; ids: string[]; turn: boolean; cx: number; cy: number; d0: number; a0: number; t: Transform; rot0: number }
  | { kind: 'twist'; ids: string[]; d0: number; a0: number; t: Transform; turns: boolean }
  | { kind: 'pan'; pid: number; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'pinch'; d0: number; z0: number; wx: number; wy: number };

export function Canvas(props: {
  pieces: CanvasPiece[];
  /** areas, under the pieces */
  areas?: CanvasArea[];
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
  /** what framing shows: this part, then (asked again) everything */
  fitRect?: Rect;
  /** closest framing, and the zoom below which framing shows the top instead of everything */
  maxFitZ?: number;
  minFitZ?: number;
  /** an area always framed along with the pieces, so one piece alone is not blown up */
  frameAlso?: Rect;
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
  /** pieces can be turned: by the round handle, two fingers, or the turn keys */
  onRotate?: (ids: string[], deg: number, keyed: boolean) => void;
  /** a handle or a twist grew and turned the selection together (else onResize, then onRotate) */
  onTransform?: (ids: string[], t: Transform) => void;
  onAction?: (a: PieceAction, ids: string[]) => void;
  /** what the toolbar by the selection offers when there is no `toolbar` */
  tools?: PieceAction[];
  /** the toolbar by the selection, in place of the standard one (null for none) */
  toolbar?: (ids: string[], at: SelBox) => ReactNode;
  /** keys for the selection the screen handles itself, before the canvas's own */
  onKey?: (e: KeyboardEvent, ids: string[]) => void;
  /** the view came to rest after a pan or zoom */
  onView?: (v: View, size: { w: number; h: number }) => void;
  /** world-space layers under and over the pieces */
  under?: ReactNode;
  over?: ReactNode;
  /** screen-space controls drawn for a piece */
  hud?: (p: CanvasPiece, at: { x: number; y: number; w: number; h: number }, s: HudState) => ReactNode;
  /** extra marks on a piece (tags) */
  decorate?: (p: CanvasPiece) => ReactNode;
  /** the floor was clicked, away from any piece (at a world point) */
  onEmpty?: (at: { x: number; y: number }) => void;
  api?: MutableRefObject<CanvasApi | null>;
  children?: ReactNode;
}) {
  const { pieces, sel } = props;
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const guideX = useRef<HTMLDivElement>(null);
  const guideY = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ z: 1, x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0 });
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const hoverOff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const anchor = useRef<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<Gesture | null>(null);
  const lastTap = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  /** on a phone, a long press starts picking several: from then on a tap adds */
  const multi = useRef(false);
  const live = useRef(props);
  live.current = props;
  const tickPending = useRef(false);
  const restT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const things = (): Thing[] => {
    const P = live.current;
    return [
      ...(P.areas ?? []).map((a) => ({ id: a.id, box: a.box, node: a.node, className: a.className, area: true })),
      ...P.pieces.map((p) => ({ ...p, area: false })),
    ];
  };
  const els = useRef(new Map<string, HTMLElement>());
  const thingOf = (id: string) => things().find((p) => p.id === id);
  const boxOf = (id: string) => thingOf(id)?.box;
  const selIds = () => { const all = new Set(things().map((t) => t.id)); return [...live.current.sel].filter((id) => all.has(id)); };
  const turnable = (ids: string[]) => !!live.current.onRotate && ids.every((id) => !thingOf(id)?.area);

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
    // Controls drawn on screen follow the view; with none showing, nothing needs drawing again.
    if ((live.current.hud || live.current.sel.size) && !tickPending.current) {
      tickPending.current = true;
      requestAnimationFrame(() => { tickPending.current = false; setTick((t) => t + 1); });
    }
    clearTimeout(restT.current);
    restT.current = setTimeout(() => live.current.onView?.(view.current, size.current), smooth ? 480 : 240);
  };
  const framing = (r: Rect) => {
    const P = live.current;
    const { w, h } = size.current;
    return frame(r, w, h, P.insets, P.maxFitZ ?? 1, P.minFitZ);
  };
  const everything = (): Rect | null => {
    const P = live.current;
    let r: Rect | null = bounds(things().map((p) => p.box));
    if (P.paper) r = union(r, { x0: 0, y0: 0, x1: P.paper.w, y1: P.paper.h });
    if (P.frameAlso) r = union(r, P.frameAlso);
    return r;
  };
  const fit = (smooth = false, again = false) => {
    const P = live.current;
    if (!size.current.w || !size.current.h) return;
    if (P.fitRect) {
      const v = framing(P.fitRect), c = view.current;
      const there = Math.abs(v.z / c.z - 1) < 0.04 && Math.abs(v.x - c.x) < 16 && Math.abs(v.y - c.y) < 16;
      if (!again || !there) return apply(v, smooth);
    }
    const r = everything();
    if (r) apply(framing(r), smooth);
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  if (props.api) {
    props.api.current = {
      fit,
      frame: (r, smooth) => { if (size.current.w) apply(framing(r), smooth); },
      view: () => view.current,
      size: () => size.current,
      toScreen: (x, y) => ({ x: x * view.current.z + view.current.x, y: y * view.current.z + view.current.y }),
      toWorld: (sx, sy) => toWorld(view.current, sx, sy),
      el: () => root.current,
    };
  }

  // Frame everything once there is room to, and again when asked.
  const framed = useRef(false);
  const ready = () => things().length > 0 || !!live.current.paper || !!live.current.frameAlso || !!live.current.fitRect;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const first = !size.current.w;
      size.current = { w: el.clientWidth, h: el.clientHeight };
      if (first || !framed.current) { framed.current = ready(); fit(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastKey = useRef(props.fitKey);
  useLayoutEffect(() => {
    if (!size.current.w) return;
    if (!framed.current && ready()) { framed.current = true; fit(); return; }
    if (lastKey.current !== props.fitKey) { lastKey.current = props.fitKey; fit(true); }
  });
  useEffect(() => { if (!sel.size) multi.current = false; }, [sel]);

  /* ----- selecting ----- */
  const toggle = (id: string) => {
    const n = new Set(live.current.sel);
    if (!n.delete(id)) n.add(id);
    anchor.current = id;
    live.current.onSel(n);
  };
  const only = (id: string) => {
    anchor.current = id;
    const s = live.current.sel;
    if (s.size !== 1 || !s.has(id)) live.current.onSel(new Set([id]));
  };
  const range = (id: string) => {
    const P = live.current;
    const order = P.order ?? things().map((p) => p.id);
    const a = anchor.current ? order.indexOf(anchor.current) : -1;
    const b = order.indexOf(id);
    if (a < 0 || b < 0) return toggle(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    P.onSel(new Set([...P.sel, ...order.slice(lo, hi + 1)]));
  };
  /** A tap or click that didn't move: the second one in quick succession opens. */
  const tapped = (id: string, at: { x: number; y: number }, touch: boolean, e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }) => {
    const now = performance.now();
    const last = lastTap.current;
    if (last && last.id === id && now - last.t < 420 && Math.hypot(at.x - last.x, at.y - last.y) < 30 && isPointer(e, 'open')) {
      lastTap.current = null;
      const el = els.current.get(id);
      if (el) live.current.onOpen(id, el.getBoundingClientRect());
      return;
    }
    lastTap.current = { id, t: now, x: at.x, y: at.y };
    if (touch && multi.current && live.current.sel.size) return toggle(id);
    only(id);
  };

  /* ----- carrying, resizing, turning: drawn straight onto the pieces until they are put down ----- */
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
    hideGuides();
  };
  const lift = () => {
    const c = g.current;
    if (c?.kind !== 'press') return;
    clearTimeout(c.lift); clearTimeout(c.hold);
    const P = live.current;
    const ids = P.sel.has(c.id) && P.sel.size > 1 ? selIds() : [c.id];
    // What the carried pieces may snap to: their neighbours of the same sort.
    const area = !!thingOf(c.id)?.area;
    const others = things().filter((t) => t.area === area && !ids.includes(t.id)).map((t) => aabb(t.box));
    g.current = { kind: 'drag', pid: c.pid, id: c.id, ids, sx: c.sx, sy: c.sy, dx: 0, dy: 0, touch: c.touch, others };
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
    else { clearTimeout(c.lift); }
    g.current = null;
    navigator.vibrate?.(12);
    multi.current = true;
    toggle(id);
  };

  /** Snap a carried group's edges and middles to its neighbours', and show where. */
  const snap = (ids: string[], dx: number, dy: number, others: Rect[]) => {
    const z = view.current.z;
    const r0 = bounds(ids.flatMap((id) => { const b = boxOf(id); return b ? [aabb(b)].map((a) => ({ cx: (a.x0 + a.x1) / 2, cy: (a.y0 + a.y1) / 2, w: a.x1 - a.x0, h: a.y1 - a.y0 })) : []; }));
    if (!r0 || !others.length) return { dx, dy };
    const r = { x0: r0.x0 + dx, x1: r0.x1 + dx, y0: r0.y0 + dy, y1: r0.y1 + dy };
    const th = 6 / z;
    let bx: { d: number; at: number; o: Rect } | null = null, by: { d: number; at: number; o: Rect } | null = null;
    const mine = { x: [r.x0, (r.x0 + r.x1) / 2, r.x1], y: [r.y0, (r.y0 + r.y1) / 2, r.y1] };
    for (const o of others) {
      // Only neighbours near enough to matter.
      if (o.x0 > r.x1 + 600 || o.x1 < r.x0 - 600 || o.y0 > r.y1 + 600 || o.y1 < r.y0 - 600) continue;
      const ox = [o.x0, (o.x0 + o.x1) / 2, o.x1], oy = [o.y0, (o.y0 + o.y1) / 2, o.y1];
      for (const a of mine.x) for (const b of ox) { const d = b - a; if (Math.abs(d) < th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: b, o }; }
      for (const a of mine.y) for (const b of oy) { const d = b - a; if (Math.abs(d) < th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: b, o }; }
    }
    const v = view.current;
    const gx = guideX.current, gy = guideY.current;
    if (gx) {
      if (bx) {
        const y0 = Math.min(r.y0 + (by?.d ?? 0), bx.o.y0), y1 = Math.max(r.y1 + (by?.d ?? 0), bx.o.y1);
        gx.style.cssText = `display:block;transform:translate3d(${bx.at * v.z + v.x}px,${y0 * v.z + v.y}px,0);height:${(y1 - y0) * v.z}px`;
      } else gx.style.display = 'none';
    }
    if (gy) {
      if (by) {
        const x0 = Math.min(r.x0 + (bx?.d ?? 0), by.o.x0), x1 = Math.max(r.x1 + (bx?.d ?? 0), by.o.x1);
        gy.style.cssText = `display:block;transform:translate3d(${x0 * v.z + v.x}px,${by.at * v.z + v.y}px,0);width:${(x1 - x0) * v.z}px`;
      } else gy.style.display = 'none';
    }
    return { dx: dx + (bx?.d ?? 0), dy: dy + (by?.d ?? 0) };
  };
  const hideGuides = () => {
    if (guideX.current) guideX.current.style.display = 'none';
    if (guideY.current) guideY.current.style.display = 'none';
  };

  /** The selection's frame: one piece's own (turned with it), or around several. */
  const selBox = (ids: string[]): (SelBox & { world: { cx: number; cy: number } }) | null => {
    const v = view.current;
    const bs = ids.map(boxOf).filter((b): b is Box => !!b);
    if (!bs.length) return null;
    if (bs.length === 1) {
      const b = bs[0];
      return { x: (b.cx - b.w / 2) * v.z + v.x, y: (b.cy - b.h / 2) * v.z + v.y, w: b.w * v.z, h: b.h * v.z, rot: b.rot, world: { cx: b.cx, cy: b.cy } };
    }
    const r = bs.map(aabb).reduce((a, b) => union(a, b)!);
    return { x: r.x0 * v.z + v.x, y: r.y0 * v.z + v.y, w: (r.x1 - r.x0) * v.z, h: (r.y1 - r.y0) * v.z, rot: 0, world: { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 } };
  };
  const preview = (ids: string[], t: Transform) => draw(ids, (b) => ({ b: transformed(b, t), s: t.k }));
  const commitTransform = (ids: string[], t: Transform) => {
    const P = live.current;
    if (Math.abs(t.k - 1) < 0.005 && Math.abs(t.deg) < 0.2) return;
    settle(ids);
    if (P.onTransform) return P.onTransform(ids, t);
    if (Math.abs(t.k - 1) >= 0.005) P.onResize(ids, t.k, false);
    if (Math.abs(t.deg) >= 0.2) P.onRotate?.(ids, t.deg, false);
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const handle = t.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    if (!handle && t.closest('[data-hud], button, input, a, label')) return;
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    try { root.current!.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (handle) {
      const ids = selIds();
      const f = selBox(ids);
      if (!f) return;
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      g.current = {
        kind: 'handle', pid: e.pointerId, ids, turn: handle === 'turn', cx, cy,
        d0: Math.hypot(at.x - cx, at.y - cy) || 1, a0: Math.atan2(at.y - cy, at.x - cx),
        t: { k: 1, deg: 0, px: f.world.cx, py: f.world.cy }, rot0: ids.length === 1 ? boxOf(ids[0])!.rot : 0,
      };
      setBusy(true);
      return;
    }
    if (pointers.current.size === 2) {
      // Two fingers: on the selection they grow and turn it; anywhere else they zoom the view.
      const c = g.current;
      const [a, b] = [...pointers.current.values()];
      const onSel = (c?.kind === 'press' || c?.kind === 'drag') && live.current.sel.has(c.id);
      if (c?.kind === 'press') { clearTimeout(c.lift); clearTimeout(c.hold); }
      if (c?.kind === 'drag') { restore(c.ids); setLifted([]); }
      if (c?.kind === 'resize') restore(c.ids);
      if (onSel) {
        const ids = selIds();
        const f = selBox(ids)!;
        g.current = {
          kind: 'twist', ids, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x),
          t: { k: 1, deg: 0, px: f.world.cx, py: f.world.cy }, turns: turnable(ids),
        };
        setBusy(true);
        return;
      }
      const w = toWorld(view.current, (a.x + b.x) / 2, (a.y + b.y) / 2);
      g.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: view.current.z, wx: w.x, wy: w.y };
      return;
    }
    if (pointers.current.size > 2) return;
    const id = t.closest<HTMLElement>('[data-pid]')?.dataset.pid;
    if (id) {
      if (isPointer(e, 'select')) { g.current = null; multi.current = true; toggle(id); return; }
      if (isPointer(e, 'selectRange')) { g.current = null; range(id); return; }
      if (isPointer(e, 'resize')) {
        const P = live.current;
        const ids = P.sel.has(id) && P.sel.size > 1 ? selIds() : [id];
        g.current = { kind: 'resize', pid: e.pointerId, ids, sy: at.y, k: 1 };
        setLifted(ids);
        return;
      }
      const touch = e.pointerType !== 'mouse';
      const picked = live.current.sel.has(id);
      const c: Gesture = { kind: 'press', pid: e.pointerId, id, sx: at.x, sy: at.y, touch, picked };
      // A finger rests on a piece for a moment before it lifts, so the floor can still be
      // panned; a piece already selected lifts at once.
      if (touch) { if (!picked) c.lift = setTimeout(lift, 240); c.hold = setTimeout(longPress, 480); }
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
    if (c.kind === 'pinch' || c.kind === 'twist') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      if (c.kind === 'twist') {
        const deg = ((Math.atan2(b.y - a.y, b.x - a.x) - c.a0) * 180) / Math.PI;
        c.t = { ...c.t, k: Math.min(5, Math.max(0.2, d / c.d0)), deg: c.turns ? settleTurn(0, deg, false) : 0 };
        preview(c.ids, c.t);
        return;
      }
      const v = zoomAround({ z: c.z0, x: 0, y: 0 }, c.z0 * (d / c.d0), 0, 0);
      apply({ z: v.z, x: (a.x + b.x) / 2 - c.wx * v.z, y: (a.y + b.y) / 2 - c.wy * v.z });
      return;
    }
    if (c.pid !== e.pointerId) return;
    if (c.kind === 'handle') {
      if (c.turn) {
        const deg = ((Math.atan2(at.y - c.cy, at.x - c.cx) - c.a0) * 180) / Math.PI;
        c.t = { ...c.t, deg: settleTurn(c.rot0, deg, e.shiftKey) };
      } else {
        c.t = { ...c.t, k: Math.min(5, Math.max(0.2, Math.hypot(at.x - c.cx, at.y - c.cy) / c.d0)) };
      }
      preview(c.ids, c.t);
      return;
    }
    if (c.kind === 'press') {
      const far = Math.hypot(at.x - c.sx, at.y - c.sy);
      if (c.touch && !c.picked) {
        if (far > 8) {
          // That was a pan, not a pick-up.
          clearTimeout(c.lift); clearTimeout(c.hold);
          g.current = { kind: 'pan', pid: c.pid, sx: c.sx, sy: c.sy, vx: view.current.x, vy: view.current.y, moved: true };
          move(e);
        }
      } else if (far > (c.touch ? 6 : 4)) { lift(); move(e); }
      return;
    }
    if (c.kind === 'drag') {
      const z = view.current.z;
      const s = snap(c.ids, (at.x - c.sx) / z, (at.y - c.sy) / z, c.others);
      c.dx = s.dx; c.dy = s.dy;
      draw(c.ids, (b) => ({ b: { ...b, cx: b.cx + c.dx, cy: b.cy + c.dy }, s: 1.03 }));
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
    if (c.kind === 'twist') {
      g.current = null;
      setBusy(false);
      restore(c.ids);
      if (!cancelled) commitTransform(c.ids, c.t);
      return;
    }
    if (c.pid !== e.pointerId) return;
    g.current = null;
    root.current?.classList.remove('is-panning');
    if (c.kind === 'handle') {
      setBusy(false);
      restore(c.ids);
      if (!cancelled) commitTransform(c.ids, c.t);
      return;
    }
    if (c.kind === 'press') {
      clearTimeout(c.lift); clearTimeout(c.hold);
      if (cancelled) return;
      tapped(c.id, local(e), c.touch, e);
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
      } else if (c.touch) {
        // Held a moment and let go without moving: still a tap.
        tapped(c.id, local(e), true, e);
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
      const at = local(e);
      P.onEmpty?.(toWorld(view.current, at.x, at.y));
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
      // A trackpad pinch arrives as a wheel with Ctrl held, on every browser.
      if (e.ctrlKey || isPointer(e, 'zoom')) {
        const v = view.current;
        // A mouse wheel's notch is a big jump; a pinch sends many small ones.
        const dy = Math.max(-40, Math.min(40, e.deltaY * k));
        apply(zoomAround(v, v.z * Math.exp(-dy * 0.01), e.clientX - r.left, e.clientY - r.top));
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
      // Whatever lies on top (a sheet, a piece's page) has the keyboard.
      if (!P.active || e.defaultPrevented || covered('page')) return;
      root.current?.classList.toggle('is-resizing-key', isPointer(e, 'resize'));
      const ids = selIds();
      P.onKey?.(e, ids);
      if (e.defaultPrevented) return;
      if (isKey(e, 'selectAll')) { e.preventDefault(); P.onSel(new Set(P.pieces.map((p) => p.id))); return; }
      if (isKey(e, 'fit')) { e.preventDefault(); fit(true, true); return; }
      if (!ids.length) return;
      if (isKey(e, 'close')) { e.preventDefault(); P.onSel(new Set()); return; }
      const nudge = 6 / view.current.z;
      if (isKey(e, 'nudge') || isKey(e, 'shove')) {
        e.preventDefault();
        const d = arrowOf(e);
        if (d) P.onMove(ids, d[0] * nudge, d[1] * nudge, true);
        return;
      }
      if (isKey(e, 'grow')) { e.preventDefault(); P.onResize(ids, 1.06, true); return; }
      if (isKey(e, 'shrink')) { e.preventDefault(); P.onResize(ids, 1 / 1.06, true); return; }
      if (turnable(ids) && (isKey(e, 'turnBack') || isKey(e, 'turn'))) {
        e.preventDefault();
        P.onRotate!(ids, isKey(e, 'turnBack') ? -15 : 15, true);
        return;
      }
      const acts: PieceAction[] = ['remove', 'forward', 'backward', 'flip', 'duplicate'];
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

  const all = things();
  const ids = selIds();
  const carrying = lifted.length > 0 || busy;
  const f = ids.length && !carrying ? selBox(ids) : null;
  const turns = turnable(ids);
  const tools = props.tools ?? ['forward', 'backward', 'flip'];
  const bar = f && (props.toolbar ? props.toolbar(ids, f) : props.onAction ? (
    <>
      {tools.map((a) => <ToolBtn key={a} a={a} onClick={() => props.onAction!(a, ids)} />)}
    </>
  ) : null);
  // The toolbar sits over the selection, or under it where there is no room above.
  const barAt = f && (() => {
    const t = (rad(f.rot)), c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
    const hh = (f.w * s + f.h * c) / 2, cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const above = cy - hh - (turns ? 48 : 16);
    const below = cy + hh + 16;
    const W = size.current.w, H = size.current.h;
    const room = props.insets.top + 44;
    const x = Math.min(W - 24, Math.max(24, cx));
    return above > room ? { x, y: above, up: true } : { x, y: Math.min(below, H - props.insets.bottom - 8), up: false };
  })();

  return (
    <div
      ref={root}
      className={'canvas' + (sel.size ? ' is-selecting' : '') + (carrying ? ' is-carrying' : '') + (f ? ' has-frame' : '')}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('[data-pid], [data-hud], [data-handle]')) fit(true); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={world} className="canvas__world" style={{ transform: `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.z})` }}>
        {props.paper && <div className="canvas__paper" style={{ width: props.paper.w, height: props.paper.h, background: props.paper.color }} />}
        {props.under}
        {all.map((p) => {
          const b = p.box;
          const on = sel.has(p.id);
          const up = lifted.includes(p.id);
          return (
            <div
              key={p.id}
              data-pid={p.id}
              ref={(el) => { if (el) els.current.set(p.id, el); else els.current.delete(p.id); }}
              className={(p.area ? 'piece is-area' : 'piece') + (on ? ' is-selected' : '') + (up ? ' is-lifted' : '') + (p.className ? ' ' + p.className : '')}
              role="button"
              aria-label={p.item ? p.item.name || p.item.category : undefined}
              aria-pressed={sel.size ? on : undefined}
              style={{ width: b.w, height: b.h, transform: place(b), zIndex: up ? 9999 : b.z, ['--unrot' as string]: `${-b.rot}deg` }}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') hoverOn(p.id); }}
              onPointerLeave={(e) => { if (e.pointerType === 'mouse') hoverOut(); }}
            >
              {p.item ? (
                <div className="piece__in">
                  <div className="piece__pic" style={p.flip ? { transform: 'scaleX(-1)' } : undefined}>
                    <Garment item={p.item} size={props.full ? 'full' : 'thumb'} small={!props.full && b.w * v.z < 150} />
                  </div>
                  {props.decorate?.(p as CanvasPiece)}
                </div>
              ) : <div className="piece__in">{p.node}</div>}
            </div>
          );
        })}
        {props.over}
      </div>
      <div className="canvas__hud">
        <div ref={guideX} className="guide is-x" />
        <div ref={guideY} className="guide is-y" />
        {props.hud && pieces.map((p) => {
          const b = p.box;
          const s: HudState = { hover: hover === p.id, selected: sel.has(p.id), lifted: lifted.includes(p.id) || (busy && sel.has(p.id)), anyHover: !!hover };
          const node = props.hud!(p, { x: (b.cx - b.w / 2) * v.z + v.x, y: (b.cy - b.h / 2) * v.z + v.y, w: b.w * v.z, h: b.h * v.z }, s);
          return node ? (
            <div key={p.id} data-hud onPointerEnter={() => hoverOn(p.id)} onPointerLeave={hoverOut}>{node}</div>
          ) : null;
        })}
        {f && (
          <div className={'frame' + (ids.length > 1 ? ' is-group' : '')} style={{
            width: f.w, height: f.h,
            transform: `translate3d(${f.x}px, ${f.y}px, 0) rotate(${f.rot}deg)`,
          }}>
            {(['nw', 'ne', 'sw', 'se'] as const).map((c) => <i key={c} data-handle="scale" className={'frame__corner is-' + c} />)}
            {turns && <i data-handle="turn" className="frame__turn" title="Turn" />}
          </div>
        )}
        {bar && barAt && (
          <div data-hud className={'toolbar' + (barAt.up ? '' : ' is-below')} role="toolbar" aria-label="Selected"
            style={{ left: barAt.x, top: barAt.y }}>{bar}</div>
        )}
      </div>
      {props.children}
    </div>
  );
}

const TOOL: Record<PieceAction, { icon: string; label: string; key: Parameters<typeof hint>[0] }> = {
  forward: { icon: 'front', label: 'Bring forward', key: 'forward' },
  backward: { icon: 'behind', label: 'Send back', key: 'backward' },
  flip: { icon: 'flip', label: 'Flip', key: 'flip' },
  duplicate: { icon: 'copy', label: 'Copy', key: 'duplicate' },
  remove: { icon: 'bin', label: 'Remove', key: 'remove' },
};
/** One button of the toolbar by the selection. */
export function ToolBtn({ a, onClick }: { a: PieceAction; onClick: () => void }) {
  const t = TOOL[a];
  return <button className="hud__btn" aria-label={t.label} title={`${t.label} (${hint(t.key)})`} onClick={onClick}><Icon name={t.icon} /></button>;
}
