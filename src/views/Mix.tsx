import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keepLook } from '../lib/actions';
import { newLook } from '../lib/boards';
import { drawn, realSize } from '../lib/kind';
import { useStore } from '../lib/store';
import { BOARD_RATIO, uid, type Category, type Item, type Placed } from '../lib/types';
import { Garment, Icon, Mark, toast } from '../ui';

/** The rails you can swipe, top to bottom. Tops and dresses share one rail. `cm` is the room a rail gets. */
const RAILS = [
  { id: 'outer', label: 'jacket', cats: ['outer'] as Category[], cm: 78 },
  { id: 'top', label: 'top', cats: ['top', 'dress'] as Category[], cm: 68 },
  { id: 'bottom', label: 'bottom', cats: ['bottom'] as Category[], cm: 96 },
  { id: 'socks', label: 'socks', cats: ['socks'] as Category[], cm: 24 },
  { id: 'shoes', label: 'shoes', cats: ['shoes'] as Category[], cm: 30 },
  { id: 'bag', label: 'bag', cats: ['bag'] as Category[], cm: 40 },
  { id: 'extra', label: 'accessory', cats: ['extra'] as Category[], cm: 30 },
] as const;
type RailId = (typeof RAILS)[number]['id'];

/** How a rail should change: which way the old piece leaves, and after how long. */
interface Motion { dir: number; delay: number }
interface Layer { key: number; item: Item; role: 'in' | 'out'; dir: number; delay: number }

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One rail: the current piece plus whatever is still sliding out. */
function Rail({ item, count, index, top, height, span, pxPerCm, label, selected, motion, onStep }: {
  item: Item | undefined;
  count: number;
  index: number;
  top: number;
  height: number;
  /** width of the whole mixer, in pixels */
  span: number;
  pxPerCm: number;
  label: string;
  selected: boolean;
  /** set by the parent just before it changes `item` */
  motion: () => Motion | undefined;
  onStep: (delta: number, dir: number) => void;
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
      // No direction given (the pool changed under us): just show the right piece.
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

  const off = span * 0.6;
  useLayoutEffect(() => {
    for (const key of [...started.current.keys()]) if (!layers.some((l) => l.key === key)) started.current.delete(key);
    for (const l of layers) {
      const el = els.current.get(l.key);
      if (!el || started.current.get(l.key) === l.role) continue;
      started.current.set(l.key, l.role);
      const far = off + el.offsetWidth / 2;
      if (l.role === 'out') {
        // Leave from wherever it is right now: mid-drag, mid-arrival, or at rest.
        const from = getComputedStyle(el).transform;
        el.getAnimations().forEach((a) => a.cancel());
        el.style.transform = '';
        el.style.pointerEvents = 'none';
        el.animate(
          [{ transform: from === 'none' ? 'translateX(0)' : from }, { transform: `translateX(${l.dir * far}px) rotate(${l.dir * 7}deg)` }],
          { duration: 360, delay: l.delay, easing: 'cubic-bezier(.5,0,.85,.45)', fill: 'both' },
        ).onfinish = () => setLayers((old) => old.filter((x) => x.key !== l.key));
      } else if (l.dir) {
        // Arrive from the other side, following the piece that left.
        el.animate(
          [{ transform: `translateX(${-l.dir * far}px) rotate(${-l.dir * 7}deg)` }, { transform: 'translateX(0) rotate(0deg)' }],
          { duration: 560, delay: l.delay + 70, easing: 'cubic-bezier(.2,1.15,.35,1)', fill: 'backwards' },
        );
      }
    }
  }, [layers, off]);

  // Drag a piece sideways to swipe it; a tap moves on to the next one.
  const drag = useRef<{ id: number; x: number; dx: number } | null>(null);
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (count < 2 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.getAnimations().forEach((a) => a.cancel());
    drag.current = { id: e.pointerId, x: e.clientX, dx: 0 };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.dx = e.clientX - d.x;
    e.currentTarget.style.transform = `translateX(${d.dx}px) rotate(${(d.dx / span) * 10}deg)`;
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    if (Math.abs(d.dx) < 5) {
      el.style.transform = '';
      if (e.type === 'pointerup') onStep(1, -1);
    } else if (Math.abs(d.dx) > Math.min(64, span * 0.14) && e.type === 'pointerup') {
      // The piece carries on the way it was pushed.
      onStep(d.dx < 0 ? 1 : -1, Math.sign(d.dx));
    } else {
      const from = el.style.transform;
      el.style.transform = '';
      el.animate([{ transform: from }, { transform: 'translateX(0) rotate(0deg)' }], { duration: 380, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    }
  };

  return (
    <div className={'row' + (selected ? ' is-sel' : '')} style={{ top, height }}>
      {!item && <div className="row__none">No {label === 'shoes' ? 'shoes' : label + 's'} yet</div>}
      {layers.map((l) => {
        // True scale, as far as the rail has room for it.
        const d = drawn(realSize(l.item), pxPerCm);
        const k = Math.min(1, (span * 0.8) / d.w, (height * 0.98) / d.h);
        const w = d.w * k, h = d.h * k;
        return (
          <div
            key={l.key}
            className="row__g"
            ref={(el) => { if (el) els.current.set(l.key, el); else els.current.delete(l.key); }}
            onPointerDown={l.role === 'in' ? down : undefined}
            onPointerMove={l.role === 'in' ? move : undefined}
            onPointerUp={l.role === 'in' ? up : undefined}
            onPointerCancel={l.role === 'in' ? up : undefined}
            style={{ width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2 }}
          >
            <Garment item={l.item} size="full" />
            {l.item.status === 'wish' && <span className="tag">wishlist</span>}
          </div>
        );
      })}
      {count > 1 && (
        <span className="row__count">{String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}</span>
      )}
    </div>
  );
}

/** Lay a mixed outfit out on a board the way it is worn: top over bottom, shoes below, coat beside. */
function arrange(picks: Partial<Record<RailId, Item>>): Placed[] {
  const size = (i: Item | undefined) => (i ? realSize(i) : { w: 0, h: 0 });
  const top = size(picks.top), bottom = size(picks.bottom), outer = size(picks.outer);
  const shoes = size(picks.shoes), bag = size(picks.bag), socks = size(picks.socks), extra = size(picks.extra);
  const lap = picks.top && picks.bottom ? 5 : 0;
  const column = top.h + bottom.h - lap;
  const body = Math.max(top.w, bottom.w);
  // The board stands for this many centimetres top to bottom: enough for everything to fit.
  const cm = Math.max(
    150,
    (column + (picks.shoes ? shoes.h * 0.5 : 0)) / 0.86,
    outer.h / 0.8,
    (picks.outer ? outer.w * 0.8 + body : body + (picks.shoes ? shoes.w * 0.5 : 0)) / (BOARD_RATIO * 0.92),
  );
  const fy = (v: number) => v / cm, fx = (v: number) => v / (cm * BOARD_RATIO);
  const out: Placed[] = [];
  const put = (item: Item | undefined, s: { w: number }, x: number, y: number) => {
    if (item) out.push({ id: uid(), itemId: item.id, x, y, w: fx(s.w), rot: 0, flip: false });
  };
  const cx = picks.outer ? 0.62 : 0.5;
  const y0 = Math.max(0.05, (1 - fy(column) - (picks.shoes ? fy(shoes.h) * 0.5 : 0)) / 2);
  put(picks.bottom, bottom, cx, y0 + fy(top.h - lap) + fy(bottom.h) / 2);
  put(picks.top, top, cx, y0 + fy(top.h) / 2);
  put(picks.outer, outer, Math.max(fx(outer.w) / 2 + 0.03, cx - fx(body) / 2 - fx(outer.w) * 0.22), y0 + 0.01 + fy(outer.h) / 2);
  put(picks.shoes, shoes, Math.min(1 - fx(shoes.w) / 2 - 0.03, cx + fx(body) / 2 + fx(shoes.w) * 0.2), Math.min(0.97 - fy(shoes.h) / 2, y0 + fy(column) + fy(shoes.h) * 0.2));
  // Socks lie just left of the shoes; an accessory sits up by the shoulder, opposite any coat.
  put(picks.socks, socks, Math.max(fx(socks.w) / 2 + 0.03, cx - fx(socks.w) * 0.6), Math.min(0.97 - fy(socks.h) / 2, y0 + fy(column) + fy(socks.h) * 0.55));
  put(picks.extra, extra, Math.min(1 - fx(extra.w) / 2 - 0.03, cx + fx(body) / 2 + fx(extra.w) * 0.3), y0 + fy(extra.h) / 2 + 0.02);
  // A bag hangs on the side the coat is not on, so the two never fight for one corner.
  put(picks.bag, bag,
    picks.outer ? Math.min(1 - fx(bag.w) / 2 - 0.03, cx + fx(body) / 2 + fx(bag.w) * 0.3) : Math.max(fx(bag.w) / 2 + 0.04, cx - fx(body) / 2 - fx(bag.w) * 0.5),
    Math.min(0.95 - fy(bag.h) / 2, y0 + fy(column) * (picks.outer ? 0.55 : 0.78)));
  return out;
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
  const [on, setOn] = useState<RailId[]>(['top', 'bottom', 'shoes']);
  const [idx, setIdx] = useState<Record<RailId, number>>({ outer: 0, top: 0, bottom: 0, socks: 0, shoes: 0, bag: 0, extra: 0 });
  const [sel, setSel] = useState<RailId | null>(null);
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

  const clamp = (r: RailId) => Math.min(idx[r], Math.max(0, pools[r].length - 1));
  const dressOn = pools.top[clamp('top')]?.category === 'dress' && on.includes('top');
  const visible = RAILS.filter((r) => on.includes(r.id) && !(r.id === 'bottom' && dressOn));
  const room = (r: (typeof RAILS)[number]) => (r.id === 'top' && dressOn ? r.cm + 50 : r.cm);
  const total = visible.reduce((t, r) => t + room(r), 0) || 1;
  // One scale for every rail, so the pieces keep their sizes relative to each other.
  const pxPerCm = Math.min(size.h / total, (size.w * 0.8) / 78) * 1.04;

  const go = (r: RailId, to: number, dir: number, delay = 0) => {
    const pool = pools[r];
    if (pool.length < 2) return;
    const next = ((to % pool.length) + pool.length) % pool.length;
    if (next === clamp(r)) return;
    motions.current.set(r, { dir, delay });
    setIdx((x) => ({ ...x, [r]: next }));
  };
  /** Every rail moves on together, top to bottom, all in the same direction. */
  const all = (delta: number) => visible.forEach((r, i) => go(r.id, clamp(r.id) + delta, -delta, i * 55));
  const shuffle = () => visible.forEach((r, i) => {
    const n = pools[r.id].length, cur = clamp(r.id);
    if (n < 2) return;
    let k = cur;
    while (k === cur) k = Math.floor(Math.random() * n);
    // Neighbouring rails leave opposite ways, so a shuffle looks like one.
    go(r.id, k, i % 2 ? 1 : -1, i * 55);
  });

  const save = async () => {
    const picks: Partial<Record<RailId, Item>> = {};
    for (const r of visible) picks[r.id] = pools[r.id][clamp(r.id)];
    const pieces = arrange(picks);
    if (!pieces.length) return;
    const look = newLook(nLooks, pieces);
    await keepLook(look);
    toast('Saved', { label: 'Open', run: () => onOpenLook(look.id) });
  };

  // Arrows turn the whole outfit; up and down pick a single rail for them to turn instead.
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step) {
        e.preventDefault();
        if (sel && visible.some((r) => r.id === sel)) go(sel, clamp(sel) + step, -step);
        else all(step);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const at = visible.findIndex((r) => r.id === sel);
        const next = e.key === 'ArrowDown' ? at + 1 : at < 0 ? visible.length - 1 : at - 1;
        setSel(visible[next]?.id ?? null);
      } else if (e.key === 'Escape') setSel(null);
      else if (e.key === ' ') { e.preventDefault(); shuffle(); }
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

  let y = 0;
  return (
    <div className="mix" style={{ height: tall }}>
      <div className="mix__layers" role="group" aria-label="Rails">
        {RAILS.map((r) => (
          <button key={r.id} className={'pill' + (on.includes(r.id) ? ' is-on' : '')} aria-pressed={on.includes(r.id)}
            onClick={() => setOn((o) => (o.includes(r.id) ? o.filter((x) => x !== r.id) : [...o, r.id]))}>
            {r.label}
          </button>
        ))}
        <button className={'pill' + (withWish ? ' is-on' : '')} aria-pressed={withWish} onClick={() => setWithWish(!withWish)}>wishlist</button>
      </div>

      <div className="mix__rows" ref={box}>
        {size.h > 0 && visible.map((r) => {
          const h = (room(r) / total) * size.h;
          const top = y;
          y += h;
          return (
            <Rail
              key={r.id}
              label={r.label}
              item={pools[r.id][clamp(r.id)]}
              count={pools[r.id].length}
              index={clamp(r.id)}
              top={top}
              height={h}
              span={size.w}
              pxPerCm={pxPerCm}
              selected={sel === r.id}
              motion={() => { const m = motions.current.get(r.id); motions.current.delete(r.id); return m; }}
              onStep={(delta, dir) => go(r.id, clamp(r.id) + delta, dir)}
            />
          );
        })}
        {visible.length > 0 && (
          <>
            <button className="arrow is-prev" aria-label="Previous outfit" onClick={() => all(-1)}>
              <Icon name="prev" box="0 0 24 34" />
            </button>
            <button className="arrow is-next" aria-label="Next outfit" onClick={() => all(1)}>
              <Icon name="next" box="0 0 24 34" />
            </button>
          </>
        )}
        {!visible.length && <div className="row__none">Turn a rail on above</div>}
      </div>

      <div className="mix__dock">
        <button className="round glass" aria-label="Shuffle" onClick={shuffle}><Icon name="shuffle" /></button>
        <button className="go" onClick={save} disabled={!visible.some((r) => pools[r.id].length)}>Save this look</button>
      </div>
    </div>
  );
}
