import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keepLook } from '../lib/actions';
import { layOut, newLook } from '../lib/boards';
import { drawn, realSize } from '../lib/kind';
import { useStore } from '../lib/store';
import type { Category, Item } from '../lib/types';
import { Garment, Icon, Mark, toast } from '../ui';
import { Lock, RailPicker } from './RailPicker';

/**
 * The rails an outfit is built from. Each has a place on a flat lay: the body runs down the
 * middle (top or dress, bottom, shoes), a coat and the socks lie to the left, an accessory and
 * a bag to the right. Tops and dresses share one rail.
 */
const RAILS = [
  { id: 'top', label: 'top', title: 'tops & dresses', cats: ['top', 'dress'] as Category[] },
  { id: 'bottom', label: 'bottom', title: 'bottoms', cats: ['bottom'] as Category[] },
  { id: 'shoes', label: 'shoes', title: 'shoes', cats: ['shoes'] as Category[] },
  { id: 'outer', label: 'jacket', title: 'jackets & coats', cats: ['outer'] as Category[] },
  { id: 'socks', label: 'socks', title: 'socks', cats: ['socks'] as Category[] },
  { id: 'extra', label: 'accessory', title: 'accessories', cats: ['extra'] as Category[] },
  { id: 'bag', label: 'bag', title: 'bags', cats: ['bag'] as Category[] },
] as const;
type RailId = (typeof RAILS)[number]['id'];
const RAIL = Object.fromEntries(RAILS.map((r) => [r.id, r])) as Record<RailId, (typeof RAILS)[number]>;
/** The order the arrow keys walk through the rails: down the body, then the sides. */
const KEY_ORDER: RailId[] = ['extra', 'outer', 'top', 'bag', 'bottom', 'socks', 'shoes'];

interface Rect { x: number; y: number; w: number; h: number }
/** How a piece sits in its place: tops hang down to the waist, bottoms start at it. */
type Align = 'start' | 'center' | 'end';

/**
 * Where each rail goes, in pixels, and one scale for all of them, so a bag stays smaller than
 * a coat. Columns and rows with nothing in them fold away. All sizes are in centimetres.
 */
function plan(W: number, H: number, has: (r: RailId) => boolean, dress?: Item) {
  const upper = has('top') || has('extra') ? 72 : 0;
  let mid = has('bottom') || has('bag') ? 100 : 0;
  if (has('outer') && upper + mid < 96) mid = 96 - upper;
  // A dress takes the place of top and bottom, and the shoes come up to its hem.
  if (dress) mid = Math.max(has('outer') ? 96 - upper : 30, drawn(realSize(dress), 1).h * 1.04 - upper);
  const feet = has('shoes') || has('socks') ? 36 : 0;
  const cmH = upper + mid + feet || 1;
  const gap = 5;
  // Roomy columns where the screen is wide enough to keep the height; narrow ones on a phone.
  const cols = (roomy: boolean) => {
    const L = has('outer') ? (roomy ? 74 : 56) : has('socks') ? 28 : 0;
    const R = has('bag') || has('extra') ? (roomy ? 50 : 42) : 0;
    const C = roomy ? 70 : 64;
    return { L, C, R, cmW: L + C + R + (L ? gap : 0) + (R ? gap : 0) };
  };
  const roomy = cols(true);
  const { L, C, R, cmW } = W / roomy.cmW >= H / cmH ? roomy : cols(false);
  const k = Math.max(0.1, Math.min(W / cmW, H / cmH));
  const x0 = (W - cmW * k) / 2, y0 = Math.max(0, (H - cmH * k) / 2);
  const xs = { L: x0, C: x0 + (L ? L + gap : 0) * k, R: x0 + (L ? L + gap : 0) * k + (C + gap) * k };
  const ys = { upper: y0, mid: y0 + upper * k, feet: y0 + (upper + mid) * k };
  const box = (x: number, w: number, y: number, h: number): Rect => ({ x, y, w: w * k, h: h * k });
  const at: Record<RailId, Rect & { align: Align }> = {
    top: { ...box(xs.C, C, ys.upper, dress ? upper + mid : upper), align: dress ? 'start' : 'end' },
    bottom: { ...box(xs.C, C, ys.mid, mid), align: 'start' },
    shoes: { ...box(xs.C, C, ys.feet, feet), align: 'center' },
    outer: { ...box(xs.L, L, ys.upper, upper + mid), align: 'start' },
    socks: { ...box(xs.L, L, ys.feet, feet), align: 'center' },
    extra: { ...box(xs.R, R, ys.upper, upper), align: 'center' },
    bag: { ...box(xs.R, R, ys.mid, mid), align: upper ? 'start' : 'center' },
  };
  return { at, pxPerCm: k };
}

/** How a rail should change: which way the old piece leaves, and after how long. */
interface Motion { dir: number; delay: number }
interface Layer { key: number; item: Item; role: 'in' | 'out'; dir: number; delay: number }

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One place in the outfit: the piece on show plus whatever is still sliding out, and its controls. */
function Slot({ rail, item, count, index, rect, pxPerCm, selected, kept, picking, motion, onStep, onTap, onKeep, onClear }: {
  rail: (typeof RAILS)[number];
  item: Item | undefined;
  count: number;
  index: number;
  rect: Rect & { align: Align };
  pxPerCm: number;
  selected: boolean;
  kept: boolean;
  picking: boolean;
  /** set by the parent just before it changes `item` */
  motion: () => Motion | undefined;
  onStep: (delta: number, dir: number) => void;
  onTap: () => void;
  onKeep: () => void;
  onClear: () => void;
}) {
  const [layers, setLayers] = useState<Layer[]>(() => (item ? [{ key: 0, item, role: 'in', dir: 0, delay: 0 }] : []));
  const n = useRef(1);
  const els = useRef(new Map<number, HTMLDivElement>());
  /** Which animation each layer has already been given, so a re-render never restarts one. */
  const started = useRef(new Map<number, Layer['role']>());

  // The piece changed: the one on show leaves, the new one comes in behind it.
  const shown = useRef(item?.id);
  useLayoutEffect(() => {
    if (item?.id === shown.current) return;
    shown.current = item?.id;
    const m = motion();
    setLayers((old) => {
      if (!item) return [];
      if (!m || !m.dir || still()) return [{ key: n.current++, item, role: 'in', dir: 0, delay: 0 }];
      return [
        ...old.map((l) => (l.role === 'in' ? { ...l, role: 'out' as const, dir: m.dir, delay: m.delay } : l)),
        { key: n.current++, item, role: 'in', dir: m.dir, delay: m.delay },
      ];
    });
  });

  // A piece kept up to date while it sits on the rail (its picture or size may change).
  useEffect(() => {
    if (!item) return;
    setLayers((old) => old.map((l) => (l.role === 'in' && l.item.id === item.id && l.item !== item ? { ...l, item } : l)));
  }, [item]);

  const off = Math.max(48, rect.w * 0.55);
  useLayoutEffect(() => {
    for (const key of [...started.current.keys()]) if (!layers.some((l) => l.key === key)) started.current.delete(key);
    for (const l of layers) {
      const el = els.current.get(l.key);
      if (!el || started.current.get(l.key) === l.role) continue;
      started.current.set(l.key, l.role);
      if (l.role === 'out') {
        // Leave from wherever it is right now: mid-drag, mid-arrival, or at rest.
        const from = getComputedStyle(el).transform;
        el.getAnimations().forEach((a) => a.cancel());
        el.style.transform = '';
        el.style.pointerEvents = 'none';
        el.animate(
          [{ transform: from === 'none' ? 'translateX(0)' : from, opacity: 1 }, { transform: `translateX(${l.dir * off}px) rotate(${l.dir * 6}deg)`, opacity: 0 }],
          { duration: 300, delay: l.delay, easing: 'cubic-bezier(.5,0,.85,.45)', fill: 'both' },
        ).onfinish = () => setLayers((old) => old.filter((x) => x.key !== l.key));
      } else if (l.dir) {
        // Arrive from the other side, following the piece that left.
        el.animate(
          [{ transform: `translateX(${-l.dir * off}px) rotate(${-l.dir * 6}deg)`, opacity: 0 }, { transform: 'translateX(0) rotate(0deg)', opacity: 1 }],
          { duration: 520, delay: l.delay + 60, easing: 'cubic-bezier(.2,1.15,.35,1)', fill: 'backwards' },
        );
      }
    }
  }, [layers, off]);

  // Drag a piece sideways to swipe it; a tap opens every piece of the rail.
  const drag = useRef<{ id: number; x: number; y: number; dx: number; side: boolean } | null>(null);
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, side: false };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || count < 2) return;
    d.dx = e.clientX - d.x;
    if (!d.side) {
      // Only a sideways push is a swipe; up and down still scroll the page.
      if (Math.abs(d.dx) < 6 || Math.abs(d.dx) < Math.abs(e.clientY - d.y)) return;
      d.side = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.getAnimations().forEach((a) => a.cancel());
    }
    e.currentTarget.style.transform = `translateX(${d.dx}px) rotate(${(d.dx / Math.max(rect.w, 120)) * 8}deg)`;
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    if (!d.side) {
      if (e.type === 'pointerup' && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) onTap();
    } else if (Math.abs(d.dx) > Math.min(56, rect.w * 0.25) && e.type === 'pointerup') {
      // The piece carries on the way it was pushed.
      onStep(d.dx < 0 ? 1 : -1, Math.sign(d.dx));
    } else {
      const from = el.style.transform;
      el.style.transform = '';
      el.animate([{ transform: from }, { transform: 'translateX(0) rotate(0deg)' }], { duration: 380, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    }
  };

  // True scale, as far as the place has room for it.
  const fit = (it: Item) => {
    const d = drawn(realSize(it), pxPerCm);
    const k = Math.min(1, (rect.w * 0.94) / d.w, (rect.h * 0.96) / d.h);
    return { w: d.w * k, h: d.h * k };
  };
  const now = item && fit(item);
  const y = (h: number) => (rect.align === 'start' ? rect.h * 0.02 : rect.align === 'end' ? rect.h * 0.98 - h : (rect.h - h) / 2);
  const cls = 'slot' + (selected ? ' is-sel' : '') + (picking ? ' is-picking' : '') + (kept ? ' is-kept' : '') + (item ? '' : ' is-empty');

  return (
    <div className={cls} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      {!item && (
        <button className="slot__add" onClick={onTap} aria-label={`Add ${rail.label}`}
          style={{ width: Math.min(rect.w * 0.8, 120), height: Math.min(rect.h * 0.7, 90) }}>
          <Icon name="plus" />{rail.label}
        </button>
      )}
      {layers.map((l) => {
        const s = fit(l.item);
        return (
          <div
            key={l.key}
            className="slot__g"
            ref={(el) => { if (el) els.current.set(l.key, el); else els.current.delete(l.key); }}
            onPointerDown={l.role === 'in' ? down : undefined}
            onPointerMove={l.role === 'in' ? move : undefined}
            onPointerUp={l.role === 'in' ? up : undefined}
            onPointerCancel={l.role === 'in' ? up : undefined}
            style={{ width: s.w, height: s.h, left: (rect.w - s.w) / 2, top: y(s.h) }}
          >
            <Garment item={l.item} size="full" />
            {l.item.status === 'wish' && <span className="tag">wishlist</span>}
          </div>
        );
      })}
      {item && now && (
        <div className="slot__ctl" style={{ top: Math.max(0, y(now.h) - 4) }}>
          <button className="slot__name" onClick={onTap} aria-label={`All ${rail.title}`}>
            {rail.label}{count > 1 && <span className="num"> {index + 1}/{count}</span>}
          </button>
          <span className="slot__gap" />
          <button className="slot__btn" aria-pressed={kept} aria-label={kept ? `Let go of this ${rail.label}` : `Keep this ${rail.label}`} onClick={onKeep}>
            <Lock shut={kept} />
          </button>
          <button className="slot__btn" aria-label={`Clear ${rail.label}`} onClick={onClear}><Icon name="x" /></button>
        </div>
      )}
      {item && now && kept && <span className="slot__kept" style={{ top: Math.max(0, y(now.h) - 4) }} aria-hidden="true"><Lock shut /></span>}
      {item && count > 1 && (
        <>
          <button className="slot__arrow is-prev" aria-label={`Previous ${rail.label}`} onClick={() => onStep(-1, 1)}>
            <Icon name="left" />
          </button>
          <button className="slot__arrow is-next" aria-label={`Next ${rail.label}`} onClick={() => onStep(1, -1)}>
            <Icon name="right" />
          </button>
        </>
      )}
    </div>
  );
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

export function Mix({ startWith, active, tall, onOpenLook, onAdd }: {
  startWith: string | null;
  /** true while this is what the keyboard is talking to */
  active: boolean;
  /** how much of the page the mixer takes */
  tall: string;
  onOpenLook: (lookId: string) => void;
  onAdd: () => void;
}) {
  const items = useStore((s) => s.items);
  const nLooks = useStore((s) => s.looks.length);
  const [withWish, setWithWish] = useState(true);
  /** Rails wearing something; the rest are cleared. */
  const [on, setOn] = useState<RailId[]>(['top', 'bottom', 'shoes']);
  const [kept, setKept] = useState<RailId[]>([]);
  const [idx, setIdx] = useState<Record<RailId, number>>({ outer: 0, top: 0, bottom: 0, socks: 0, shoes: 0, bag: 0, extra: 0 });
  const [sel, setSel] = useState<RailId | null>(null);
  const [picking, setPicking] = useState<RailId | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const motions = useRef(new Map<RailId, Motion>());

  const pools = useMemo(() => {
    const ready = items.filter((i) => i.state === 'ready' && (withWish || i.status === 'owned'));
    return Object.fromEntries(RAILS.map((r) => [r.id, ready.filter((i) => r.cats.includes(i.category))])) as Record<RailId, Item[]>;
  }, [items, withWish]);

  // Opened from a piece: put that piece on its rail.
  useEffect(() => {
    if (!startWith) return;
    const it = items.find((i) => i.id === startWith);
    const rail = it && RAILS.find((r) => r.cats.includes(it.category));
    if (!it || !rail) return;
    if (it.status === 'wish') setWithWish(true);
    setOn((o) => (o.includes(rail.id) ? o : [...o, rail.id]));
    setIdx((x) => ({ ...x, [rail.id]: Math.max(0, pools[rail.id].findIndex((p) => p.id === it.id)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);

  const anything = RAILS.some((r) => pools[r.id].length);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [anything]);

  const has = (r: RailId) => pools[r].length > 0;
  const clamp = (r: RailId) => Math.min(idx[r], Math.max(0, pools[r].length - 1));
  const wearing = (r: RailId) => on.includes(r) && has(r);
  const current = (r: RailId) => (wearing(r) ? pools[r][clamp(r)] : undefined);
  const dressOn = current('top')?.category === 'dress';
  /** The places shown: every rail with pieces, except the bottom under a dress. */
  const shown = RAILS.filter((r) => has(r.id) && !(r.id === 'bottom' && dressOn));
  const { at, pxPerCm } = plan(size.w, size.h, has, dressOn ? current('top') : undefined);

  const go = (r: RailId, to: number, dir: number, delay = 0) => {
    const pool = pools[r];
    if (!pool.length) return;
    const next = ((to % pool.length) + pool.length) % pool.length;
    if (!on.includes(r)) {
      setOn((o) => [...o, r]);
      setIdx((x) => ({ ...x, [r]: next }));
      return;
    }
    if (next === clamp(r)) return;
    motions.current.set(r, { dir, delay });
    setIdx((x) => ({ ...x, [r]: next }));
  };
  const step = (r: RailId, delta: number) => go(r, clamp(r) + delta, -delta);
  const free = shown.filter((r) => wearing(r.id) && !kept.includes(r.id));
  /** Every piece not kept moves on together, all in the same direction. */
  const all = (delta: number) => free.forEach((r, i) => go(r.id, clamp(r.id) + delta, -delta, i * 55));
  const shuffle = () => free.forEach((r, i) => {
    const n = pools[r.id].length, cur = clamp(r.id);
    if (n < 2) return;
    let k = cur;
    while (k === cur) k = Math.floor(Math.random() * n);
    // Neighbouring rails leave opposite ways, so a shuffle looks like one.
    go(r.id, k, i % 2 ? 1 : -1, i * 55);
  });
  const keep = (r: RailId) => setKept((k) => (k.includes(r) ? k.filter((x) => x !== r) : [...k, r]));
  const clear = (r: RailId) => {
    setOn((o) => o.filter((x) => x !== r));
    setKept((k) => k.filter((x) => x !== r));
  };
  const tap = (r: RailId) => {
    if (!on.includes(r)) setOn((o) => [...o, r]);
    setSel(r);
    setPicking((p) => (p === r && on.includes(r) ? null : r));
  };

  const save = async () => {
    const order: RailId[] = ['top', 'bottom', 'shoes', 'socks', 'outer', 'bag', 'extra'];
    const picks = order.filter((r) => !(r === 'bottom' && dressOn)).map(current).filter((i): i is Item => !!i);
    if (!picks.length) return;
    const look = newLook(nLooks, layOut(picks, items));
    await keepLook(look);
    toast('Saved', { label: 'Open', run: () => onOpenLook(look.id) });
  };
  const canSave = shown.some((r) => wearing(r.id));

  // Arrows turn every piece not kept; up and down pick a single rail for them to turn instead.
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const order = KEY_ORDER.filter((r) => shown.some((s) => s.id === r));
      const target = picking ?? (sel && order.includes(sel) ? sel : null);
      const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (delta) {
        e.preventDefault();
        if (target) step(target, delta);
        else all(delta);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = order.findIndex((r) => r === target);
        const next = order[e.key === 'ArrowDown' ? i + 1 : i < 0 ? order.length - 1 : i - 1] ?? null;
        setSel(next);
        if (picking) setPicking(next);
      } else if (e.key === 'Escape') {
        if (picking) setPicking(null);
        else setSel(null);
      } else if (e.key === ' ') { e.preventDefault(); shuffle(); }
      else if (e.key.toLowerCase() === 'l' && target) keep(target);
      else if ((e.key === 'Backspace' || e.key === 'Delete') && target) { e.preventDefault(); clear(target); }
      else if (e.key === 'Enter' && target && !(e.target instanceof HTMLButtonElement)) tap(target);
      else if (e.key.toLowerCase() === 's' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) void save();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!anything) {
    return (
      <div className="mix" style={{ height: tall }}>
        <div className="empty">
          <Mark className="mark" />
          <p>Outfits are mixed here from the pieces in your closet.</p>
          <button className="go" onClick={onAdd}><Icon name="plus" />Add a piece</button>
        </div>
      </div>
    );
  }

  const pickRail = picking && has(picking) ? RAIL[picking] : null;
  return (
    <div className={'mix' + (pickRail ? ' is-picking' : '')} style={{ height: tall }}>
      <div className="mix__layers">
        <button className={'pill' + (withWish ? ' is-on' : '')} aria-pressed={withWish} onClick={() => setWithWish(!withWish)}>wishlist</button>
        {kept.length > 0 && <button className="pill" onClick={() => setKept([])}><Lock shut={false} />let go</button>}
      </div>

      <div className="mix__rows mix__lay" ref={box} role="group" aria-label="Outfit"
        onPointerDown={(e) => { if (e.target === e.currentTarget) { setSel(null); setPicking(null); } }}>
        {size.h > 0 && shown.map((r) => (
          <Slot
            key={r.id}
            rail={r}
            item={current(r.id)}
            count={pools[r.id].length}
            index={clamp(r.id)}
            rect={at[r.id]}
            pxPerCm={pxPerCm}
            selected={sel === r.id}
            kept={kept.includes(r.id)}
            picking={picking === r.id}
            motion={() => { const m = motions.current.get(r.id); motions.current.delete(r.id); return m; }}
            onStep={(delta, dir) => go(r.id, clamp(r.id) + delta, dir)}
            onTap={() => tap(r.id)}
            onKeep={() => keep(r.id)}
            onClear={() => clear(r.id)}
          />
        ))}
      </div>

      {pickRail && (
        <RailPicker
          title={pickRail.title}
          pool={pools[pickRail.id]}
          current={clamp(pickRail.id)}
          on={wearing(pickRail.id)}
          kept={kept.includes(pickRail.id)}
          onPick={(i) => { const c = clamp(pickRail.id); go(pickRail.id, i, i > c ? -1 : 1); }}
          onKeep={() => keep(pickRail.id)}
          onClear={() => clear(pickRail.id)}
          onClose={() => setPicking(null)}
        />
      )}

      <div className="mix__dock">
        <button className="round glass" aria-label="Shuffle" title="Shuffle what is not kept" onClick={shuffle}><Icon name="shuffle" /></button>
        <button className="go" onClick={save} disabled={!canSave}>Save this look</button>
      </div>
    </div>
  );
}
